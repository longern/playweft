import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatformSession } from "./platform-api";
import EntryOverlay from "./EntryOverlay";
import Home from "./Home";
import RoomHost from "./RoomHost";
import SoloHost from "./SoloHost";
import UpdateToast from "./UpdateToast";
import { gameLaunchPath } from "./game-launch-link";
import { gameUrlFromExternalLaunch, saveRecentGame } from "./game-launch";
import type { DiscoveredGame as RecentGame } from "./game-manifest";
import { useI18n } from "./i18n";
import {
  persistAccountPlayerNickname,
  persistGuestPlayerNickname,
  readAccountPlayerNickname,
  readGuestPlayerNickname,
} from "./player-profile";
import { prepareGameOrientation } from "./use-game-viewport";
import { usePwaUpdate } from "./use-pwa-update";

const SOLO_EXIT_DURATION_MS = 160;

export default function App() {
  const { t } = useI18n();
  const pwaUpdate = usePwaUpdate();
  const [location, setLocation] = useState(readAppLocation);
  const [entryStatus, setEntryStatus] = useState<string>();
  const [soloGame, setSoloGame] = useState<RecentGame>();
  const [soloClosing, setSoloClosing] = useState(false);
  const [nickname, setNickname] = useState<string>();
  const accountKeyRef = useRef<string | undefined>(undefined);
  const entryGeneration = useRef(0);
  const handledExternalGameUrl = useRef<string | undefined>(undefined);
  const soloGameRef = useRef<RecentGame | undefined>(undefined);
  const soloExitTimer = useRef<number | undefined>(undefined);
  soloGameRef.current = soloGame;
  const path = new URL(location, window.location.origin).pathname;
  const externalGameUrl = gameUrlFromExternalLaunch(location);

  useEffect(() => {
    const onPopState = () => {
      setLocation(readAppLocation());
      if (!soloGameRef.current) return;
      setSoloClosing(true);
      window.clearTimeout(soloExitTimer.current);
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? 0
        : SOLO_EXIT_DURATION_MS;
      soloExitTimer.current = window.setTimeout(() => {
        setSoloGame(undefined);
        setSoloClosing(false);
      }, duration);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.clearTimeout(soloExitTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getPlatformSession()
      .then((session) => {
        if (cancelled) return;
        if (session.provider === "x" && session.accountKey) {
          accountKeyRef.current = session.accountKey;
          setNickname(
            readAccountPlayerNickname(
              session.accountKey,
              session.name ?? session.accountName,
            ),
          );
          return;
        }
        accountKeyRef.current = undefined;
        setNickname(readGuestPlayerNickname());
      })
      .catch(() => {
        if (cancelled) return;
        accountKeyRef.current = undefined;
        setNickname(readGuestPlayerNickname());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setLocation(readAppLocation());
  }, []);
  const openSoloGame = useCallback((game: RecentGame) => {
    void prepareGameOrientation(game.orientation);
    window.clearTimeout(soloExitTimer.current);
    setSoloClosing(false);
    const nextPath = gameLaunchPath(game.manifestUrl);
    if (gameUrlFromExternalLaunch(readAppLocation())) {
      window.history.replaceState({}, "", "/");
    }
    window.history.pushState({ playweftView: "solo" }, "", nextPath);
    setLocation(readAppLocation());
    setSoloGame(game);
  }, []);
  const claimExternalGameUrl = useCallback((url: string) => {
    if (handledExternalGameUrl.current === url) return false;
    handledExternalGameUrl.current = url;
    return true;
  }, []);
  const changeNickname = useCallback((value: string) => {
    const accountKey = accountKeyRef.current;
    setNickname(
      accountKey
        ? persistAccountPlayerNickname(accountKey, value)
        : persistGuestPlayerNickname(value),
    );
  }, []);
  const roomId = /^\/r\/([a-zA-Z0-9_-]{1,128})$/.exec(path)?.[1];

  useEffect(() => {
    if (roomId) setEntryStatus(undefined);
  }, [roomId]);

  useEffect(() => {
    if (!externalGameUrl) handledExternalGameUrl.current = undefined;
  }, [externalGameUrl]);

  const beginEntry = useCallback(() => {
    const generation = ++entryGeneration.current;
    setEntryStatus(t("creatingRoom"));
    return () => entryGeneration.current !== generation;
  }, [t]);

  const cancelEntry = useCallback(() => {
    entryGeneration.current += 1;
    setEntryStatus(undefined);
    setSoloGame(undefined);
    navigate("/");
  }, [navigate]);

  const overlayStatus = entryStatus;
  const showUpdateToast =
    pwaUpdate.updateAvailable &&
    path === "/" &&
    !externalGameUrl &&
    !soloGame &&
    !overlayStatus;

  if (nickname === undefined) {
    if (roomId) {
      return (
        <main className="room-entry-state">
          <div
            className="room-entry-state-content"
            role="status"
            aria-label={t("loadingProfile")}
          >
            <span className="loading-spinner" aria-hidden="true" />
          </div>
        </main>
      );
    }
    return <EntryOverlay status={t("loadingProfile")} />;
  }

  if (roomId) {
    return (
      <RoomHost
        key={roomId}
        nickname={nickname}
        roomId={roomId}
        onBack={() => navigate("/")}
        onGameDiscovered={saveRecentGame}
        onNicknameChange={changeNickname}
      />
    );
  }

  return (
    <>
      <div
        aria-hidden={soloGame ? true : undefined}
        inert={soloGame ? true : undefined}
      >
        <Home
          externalGameUrl={soloGame ? undefined : externalGameUrl}
          suppressGameShelves={Boolean(externalGameUrl || soloGame)}
          nickname={nickname}
          onNavigate={navigate}
          onBeginEntry={beginEntry}
          onEntryStatus={setEntryStatus}
          onPlaySolo={openSoloGame}
          onClaimExternalGameUrl={claimExternalGameUrl}
          onNicknameChange={changeNickname}
        />
      </div>
      {soloGame && (
        <SoloHost
          closing={soloClosing}
          game={soloGame}
          nickname={nickname}
          onBack={() => window.history.back()}
        />
      )}
      {overlayStatus && (
        <EntryOverlay status={overlayStatus} onCancel={cancelEntry} />
      )}
      {showUpdateToast && (
        <UpdateToast
          updating={pwaUpdate.updating}
          onRefresh={() => void pwaUpdate.applyUpdate()}
          onDismiss={pwaUpdate.dismissUpdate}
        />
      )}
    </>
  );
}

function readAppLocation(): string {
  return `${window.location.pathname}${window.location.search}`;
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronRight } from "lucide-react";
import { JsonRpcErrorCode } from "@playweft/game-protocol";
import {
  createGuestSession,
  createRoom,
  getPlatformSession,
} from "./platform-api";
import RoomHost from "./RoomHost";
import { useFeaturedGames, type FeaturedGame } from "./featured-games";
import Dialog from "./Dialog";
import ErrorToast from "./ErrorToast";
import GameHelpDialog from "./GameHelpDialog";
import GameInfoPanel from "./GameInfoPanel";
import GameMenu from "./GameMenu";
import GameFrame, { attachGameBridge } from "./GameFrame";
import GameWindowDialog, {
  PLATFORM_WINDOW_CAPABILITIES,
  useGameWindowDialogs,
} from "./GameWindowDialog";
import GameViewport from "./GameViewport";
import PlayerProfileMenu from "./PlayerProfileMenu";
import UpdateToast from "./UpdateToast";
import { gameLaunchPath } from "./game-launch-link";
import { ClipboardPrompt, useClipboardRead } from "./ClipboardPrompt";
import {
  UserProfilePrompt,
  userProfileFieldsFromRpcParams,
  useUserProfileAccess,
} from "./UserProfilePrompt";
import {
  isFavoriteGame,
  persistFavoriteGames,
  readFavoriteGames,
  toggleFavoriteGame,
} from "./favorite-games";
import {
  PLAYWEFT_BRIDGE_VERSION,
  RpcFault,
  rpcPlatformFault,
} from "./json-rpc";
import {
  isStoredDiscoveredGame,
  loadGameManifest,
  manifestUrlFromInput,
  type LoadedGame,
  type DiscoveredGame as RecentGame,
  type GameMode,
} from "./game-manifest";
import type { MenuPosition } from "./Menu";
import {
  localizeGameDescription,
  localizeGameName,
  useI18n,
  type Translator,
} from "./i18n";
import {
  persistAccountPlayerNickname,
  persistGuestPlayerNickname,
  readAccountPlayerNickname,
  readGuestPlayerNickname,
} from "./player-profile";
import { prepareGameOrientation, useGameViewport } from "./use-game-viewport";
import { usePwaUpdate } from "./use-pwa-update";

const RECENT_GAMES_KEY = "playweft:recent-games:v1";
const MAX_RECENT_GAMES = 8;
const SOLO_EXIT_DURATION_MS = 160;
const DEFAULT_ROOM_ID_FORMAT = "code:4";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
type ShelfGame = RecentGame | FeaturedGame;
type GameShelfKind = "favorite" | "recent" | "recommended";
type ShelfGamePhase = "entering" | "exiting";
type StoredRecentGame = RecentGame & { pinned?: boolean };
type RoomIdFormat =
  | { kind: "uuid" }
  | { kind: "code" | "digits" | "base64url"; length: number };

export default function App() {
  const { t } = useI18n();
  const pwaUpdate = usePwaUpdate();
  const [location, setLocation] = useState(readAppLocation);
  const [entryStatus, setEntryStatus] = useState<string>();
  const [settledRoomId, setSettledRoomId] = useState<string>();
  const [soloGame, setSoloGame] = useState<RecentGame>();
  const [soloClosing, setSoloClosing] = useState(false);
  const [nickname, setNickname] = useState(readGuestPlayerNickname);
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
      .catch(() => undefined);
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
    if (!roomId) setSettledRoomId(undefined);
  }, [roomId]);

  useEffect(() => {
    if (!externalGameUrl) handledExternalGameUrl.current = undefined;
  }, [externalGameUrl]);

  const beginEntry = useCallback(() => {
    const generation = ++entryGeneration.current;
    setEntryStatus(t("creatingRoom"));
    return () => entryGeneration.current !== generation;
  }, []);

  const cancelEntry = useCallback(() => {
    entryGeneration.current += 1;
    setEntryStatus(undefined);
    setSoloGame(undefined);
    navigate("/");
  }, [navigate]);

  const finishEntry = useCallback((finishedRoomId: string) => {
    setSettledRoomId(finishedRoomId);
    setEntryStatus(undefined);
  }, []);
  const finishCurrentRoomEntry = useCallback(() => {
    if (roomId) finishEntry(roomId);
  }, [finishEntry, roomId]);

  const overlayStatus =
    entryStatus ??
    (roomId && settledRoomId !== roomId ? t("loadingGame") : undefined);
  const showUpdateToast =
    pwaUpdate.updateAvailable &&
    path === "/" &&
    !externalGameUrl &&
    !soloGame &&
    !overlayStatus;

  if (roomId) {
    return (
      <>
        <RoomHost
          key={roomId}
          nickname={nickname}
          roomId={roomId}
          onBack={() => navigate("/")}
          onGameDiscovered={saveRecentGame}
          onEntryStatus={setEntryStatus}
          onEntryReady={finishCurrentRoomEntry}
          onEntryFailed={finishCurrentRoomEntry}
          onNicknameChange={changeNickname}
        />
        {overlayStatus && (
          <EntryOverlay status={overlayStatus} onCancel={cancelEntry} />
        )}
      </>
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

interface HomeProps {
  externalGameUrl?: string;
  nickname: string;
  onNavigate(path: string): void;
  onBeginEntry(): () => boolean;
  onClaimExternalGameUrl(url: string): boolean;
  onEntryStatus(status: string | undefined): void;
  onNicknameChange(value: string): void;
  onPlaySolo(game: RecentGame): void;
}

function Home({
  externalGameUrl,
  nickname,
  onNavigate,
  onBeginEntry,
  onClaimExternalGameUrl,
  onEntryStatus,
  onNicknameChange,
  onPlaySolo,
}: HomeProps) {
  const { locale, t } = useI18n();
  const [gameUrl, setGameUrl] = useState("");
  const [recentGames, setRecentGames] = useState(readRecentGames);
  const [renderedRecentGames, setRenderedRecentGames] = useState(recentGames);
  const [recentGamePhases, setRecentGamePhases] = useState<
    Record<string, ShelfGamePhase>
  >({});
  const [favoriteGames, setFavoriteGames] = useState(readFavoriteGames);
  const [renderedFavoriteGames, setRenderedFavoriteGames] =
    useState(favoriteGames);
  const [favoriteGamePhases, setFavoriteGamePhases] = useState<
    Record<string, ShelfGamePhase>
  >({});
  const featuredGames = useFeaturedGames();
  const [error, setError] = useState<string>();
  const [gameMenu, setGameMenu] = useState<{
    game: ShelfGame;
    kind: GameShelfKind;
    position: MenuPosition;
  }>();
  const [gameInfo, setGameInfo] = useState<ShelfGame>();
  const [gameHelp, setGameHelp] = useState<ShelfGame>();
  const [launchChoice, setLaunchChoice] = useState<ShelfGame>();
  const [launchChoiceRoomCode, setLaunchChoiceRoomCode] = useState("");
  const [unsupportedGame, setUnsupportedGame] = useState<{
    url: string;
    error: string;
  }>();
  const favoriteIds = useMemo(
    () => new Set(favoriteGames.map((game) => game.manifestId)),
    [favoriteGames],
  );
  const roomIdInput = roomIdFromInput(gameUrl);

  const rememberGame = (game: RecentGame) => {
    saveRecentGame(game);
    const nextRecentGames = readRecentGames();
    setRecentGames(nextRecentGames);
    setRenderedRecentGames(nextRecentGames);
    setRecentGamePhases({});
    const nextFavoriteGames = readFavoriteGames();
    setFavoriteGames(nextFavoriteGames);
    setRenderedFavoriteGames(nextFavoriteGames);
    setFavoriteGamePhases({});
  };

  const playSolo = (game: RecentGame) => {
    rememberGame(game);
    onEntryStatus(undefined);
    onPlaySolo(game);
  };

  const joinRoomById = async (roomId: string) => {
    const cancelled = onBeginEntry();
    setError(undefined);
    setUnsupportedGame(undefined);
    try {
      await createGuestSession(nickname);
      if (cancelled()) return;
      onEntryStatus(t("loadingGame"));
      onNavigate(`/r/${roomId}`);
    } catch (reason) {
      if (cancelled()) return;
      onEntryStatus(undefined);
      setError(message(reason, t("unexpectedError")));
    }
  };

  const createRoomForGame = async (game: RecentGame) => {
    const cancelled = onBeginEntry();
    setError(undefined);
    setUnsupportedGame(undefined);
    try {
      await createGuestSession(nickname);
      if (cancelled()) return;
      const room = await createRoom(game.manifestUrl);
      if (cancelled()) return;
      rememberGame(game);
      onEntryStatus(t("loadingGame"));
      onNavigate(`/r/${room.roomId}`);
    } catch (reason) {
      if (cancelled()) return;
      onEntryStatus(undefined);
      setError(message(reason, t("unexpectedError")));
    }
  };

  const launchGame = (game: ShelfGame, mode?: GameMode) => {
    const recentGame = toRecentGame(game);
    const modes = supportedModes(recentGame);
    if (mode === "solo") {
      playSolo(recentGame);
      return;
    }
    if (mode === "room") {
      void createRoomForGame(recentGame);
      return;
    }
    if (modes.includes("solo") && modes.includes("room")) {
      setLaunchChoice(recentGame);
      setLaunchChoiceRoomCode("");
      return;
    }
    if (modes.includes("solo")) {
      playSolo(recentGame);
      return;
    }
    void createRoomForGame(recentGame);
  };

  const launchInput = async (url = gameUrl) => {
    const trimmed = url.trim();
    const roomId = roomIdFromInput(trimmed);
    if (roomId) {
      void joinRoomById(roomId);
      return;
    }
    const cancelled = onBeginEntry();
    setError(undefined);
    setUnsupportedGame(undefined);
    try {
      const game = await probeGame(
        trimmed,
        (status) => onEntryStatus(status),
        t,
      );
      if (cancelled()) return;
      onEntryStatus(undefined);
      launchGame(game);
    } catch (reason) {
      if (cancelled()) return;
      onEntryStatus(undefined);
      if (reason instanceof UnsupportedGameUrlError) {
        setUnsupportedGame({ url: reason.url, error: reason.message });
      } else {
        setError(message(reason, t("unexpectedError")));
      }
    }
  };

  useEffect(() => {
    if (!externalGameUrl || !onClaimExternalGameUrl(externalGameUrl)) {
      return;
    }
    setGameUrl(externalGameUrl);
    void launchInput(externalGameUrl);
  }, [externalGameUrl, onClaimExternalGameUrl]);

  const openGameMenu = (
    game: ShelfGame,
    kind: GameShelfKind,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.focus();
    setGameMenu({
      game,
      kind,
      position: { left: event.clientX, top: event.clientY },
    });
  };

  const toggleFavorite = (game: ShelfGame) => {
    if (favoriteIds.has(game.manifestId)) {
      const nextFavoriteGames = persistFavoriteGames(
        favoriteGames.filter((item) => item.manifestId !== game.manifestId),
      );
      setFavoriteGames(nextFavoriteGames);
      setFavoriteGamePhases((current) => ({
        ...current,
        [game.manifestId]: "exiting",
      }));
      return;
    }

    const nextFavoriteGames = persistFavoriteGames([
      toRecentGame(game),
      ...favoriteGames.filter((item) => item.manifestId !== game.manifestId),
    ]);
    setFavoriteGames(nextFavoriteGames);
    setRenderedFavoriteGames((current) => [
      nextFavoriteGames[0],
      ...current.filter((item) => item.manifestId !== game.manifestId),
    ]);
    setFavoriteGamePhases((current) => ({
      ...current,
      [game.manifestId]: "entering",
    }));
  };

  const finishFavoriteAnimation = (game: ShelfGame) => {
    const phase = favoriteGamePhases[game.manifestId];
    if (!phase) return;
    if (phase === "exiting") {
      setRenderedFavoriteGames((current) =>
        current.filter((item) => item.manifestId !== game.manifestId),
      );
    }
    setFavoriteGamePhases((current) => {
      const next = { ...current };
      delete next[game.manifestId];
      return next;
    });
  };

  const deleteRecent = (game: ShelfGame) => {
    const nextRecentGames = persistRecentGames(
      recentGames.filter((item) => item.manifestId !== game.manifestId),
    );
    setRecentGames(nextRecentGames);
    setRecentGamePhases((current) => ({
      ...current,
      [game.manifestId]: "exiting",
    }));
  };

  const finishRecentAnimation = (game: ShelfGame) => {
    if (recentGamePhases[game.manifestId] !== "exiting") return;
    setRenderedRecentGames((current) =>
      current.filter((item) => item.manifestId !== game.manifestId),
    );
    setRecentGamePhases((current) => {
      const next = { ...current };
      delete next[game.manifestId];
      return next;
    });
  };

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label={t("playweftHome")}>
          <img className="brand-mark" src="/favicon.svg" alt="" />
          <span>playweft</span>
        </a>
        <span className="topbar-label">{t("playGamesTogether")}</span>
        <PlayerProfileMenu
          nickname={nickname}
          onNicknameChange={onNicknameChange}
        />
      </header>
      <main className="home">
        <section
          className="launch-section"
          id="new-room"
          aria-labelledby="launch-title"
        >
          <h1 id="launch-title" className="sr-only">
            {t("createRoom")}
          </h1>
          <form
            className="launch-form"
            onSubmit={(event) => {
              event.preventDefault();
              void launchInput();
            }}
          >
            <label className="sr-only" htmlFor="game-url">
              {t("gameUrlOrRoomCode")}
            </label>
            <div className="url-input">
              <span className="url-icon" aria-hidden="true">
                ⌁
              </span>
              <input
                id="game-url"
                type="text"
                required
                placeholder={t("pasteGameUrlOrRoomCode")}
                value={gameUrl}
                onChange={(event) => setGameUrl(event.target.value)}
              />
            </div>
            <button
              className="button primary"
              disabled={!gameUrl.trim()}
              type="submit"
            >
              {roomIdInput ? t("joinRoom") : t("createRoom")}
            </button>
          </form>
        </section>

        {renderedFavoriteGames.length > 0 && (
          <GameShelf
            title={t("favorites")}
            kind="favorite"
            games={renderedFavoriteGames}
            activeGameId={
              gameMenu?.kind === "favorite"
                ? gameMenu.game.manifestId
                : undefined
            }
            getItemClassName={(game) => {
              const phase = favoriteGamePhases[game.manifestId];
              return phase ? `shelf-game-${phase}` : "";
            }}
            onItemAnimationEnd={finishFavoriteAnimation}
            onSelect={launchGame}
            onContextMenu={openGameMenu}
          />
        )}
        {renderedRecentGames.length > 0 && (
          <GameShelf
            title={t("recentlyPlayed")}
            kind="recent"
            games={renderedRecentGames}
            activeGameId={
              gameMenu?.kind === "recent" ? gameMenu.game.manifestId : undefined
            }
            getItemClassName={(game) => {
              const phase = recentGamePhases[game.manifestId];
              return phase ? `shelf-game-${phase}` : "";
            }}
            onItemAnimationEnd={finishRecentAnimation}
            onSelect={launchGame}
            onContextMenu={openGameMenu}
          />
        )}
        <GameShelf
          title={t("recommended")}
          kind="recommended"
          games={featuredGames}
          activeGameId={
            gameMenu?.kind === "recommended"
              ? gameMenu.game.manifestId
              : undefined
          }
          onSelect={launchGame}
          onContextMenu={openGameMenu}
        />
      </main>
      {error && (
        <ErrorToast message={error} onDismiss={() => setError(undefined)} />
      )}
      {gameMenu && (
        <GameMenu
          key={`${gameMenu.game.manifestId}:${gameMenu.kind}`}
          game={gameMenu.game}
          position={gameMenu.position}
          isFavorite={favoriteIds.has(gameMenu.game.manifestId)}
          canDelete={gameMenu.kind === "recent"}
          onClose={() => setGameMenu(undefined)}
          onShowInfo={() => setGameInfo(gameMenu.game)}
          onToggleFavorite={() => toggleFavorite(gameMenu.game)}
          onDelete={() => deleteRecent(gameMenu.game)}
        />
      )}
      {gameInfo && (
        <GameInfoPanel
          description={localizeGameDescription(gameInfo, locale)}
          icon={gameInfo.icon}
          isFavorite={favoriteIds.has(gameInfo.manifestId)}
          manifestUrl={gameInfo.manifestUrl}
          name={localizeGameName(gameInfo, locale)}
          url={gameInfo.url}
          onClose={() => setGameInfo(undefined)}
          onShowHelp={
            gameInfo.helpUrl ? () => setGameHelp(gameInfo) : undefined
          }
          onToggleFavorite={() => toggleFavorite(gameInfo)}
        />
      )}
      {gameHelp?.helpUrl && (
        <GameHelpDialog
          name={localizeGameName(gameHelp, locale)}
          url={gameHelp.helpUrl}
          onClose={() => setGameHelp(undefined)}
        />
      )}
      {launchChoice && (
        <LaunchChoiceDialog
          game={launchChoice}
          roomCode={launchChoiceRoomCode}
          onRoomCodeChange={setLaunchChoiceRoomCode}
          onClose={() => setLaunchChoice(undefined)}
          onPlaySolo={() => {
            setLaunchChoice(undefined);
            launchGame(launchChoice, "solo");
          }}
          onCreateRoom={() => {
            setLaunchChoice(undefined);
            launchGame(launchChoice, "room");
          }}
          onJoinRoom={(roomId) => {
            setLaunchChoice(undefined);
            void joinRoomById(roomId);
          }}
        />
      )}
      {unsupportedGame && (
        <UnsupportedGameDialog
          error={unsupportedGame.error}
          url={unsupportedGame.url}
          onClose={() => setUnsupportedGame(undefined)}
        />
      )}
    </div>
  );
}

function SoloHost({
  closing,
  game,
  nickname,
  onBack,
}: {
  closing: boolean;
  game: RecentGame;
  nickname: string;
  onBack(): void;
}) {
  const { locale, t } = useI18n();
  const [gameInfoOpen, setGameInfoOpen] = useState(false);
  const [gameHelpOpen, setGameHelpOpen] = useState(false);
  const [loaded, setLoaded] = useState<LoadedGame>();
  const [loadError, setLoadError] = useState<string>();
  const [gameRevision, setGameRevision] = useState(0);
  const [frameReady, setFrameReady] = useState(false);
  const [isFavorite, setIsFavorite] = useState(() => isFavoriteGame(game));
  const iframe = useRef<HTMLIFrameElement>(null);
  const nicknameRef = useRef(nickname);
  nicknameRef.current = nickname;
  const currentGame = loaded?.game ?? game;
  const gameName = localizeGameName(currentGame, locale);
  const gameDescription = localizeGameDescription(currentGame, locale);
  const gameOrigin = new URL(currentGame.url).origin;
  const clipboard = useClipboardRead(
    gameName,
    currentGame.manifestId,
    gameOrigin,
  );
  const userProfile = useUserProfileAccess(
    gameName,
    gameOrigin,
    currentGame.manifestId,
    nickname,
  );
  const windowDialogs = useGameWindowDialogs(gameName, gameOrigin);
  const gameViewport = useGameViewport(true, currentGame);

  useEffect(() => {
    setIsFavorite(isFavoriteGame(currentGame));
  }, [currentGame.manifestId]);

  useEffect(() => {
    let cancelled = false;
    void loadGameManifest(game.manifestUrl)
      .then((result) => {
        if (!cancelled) setLoaded(result);
      })
      .catch((reason) => {
        if (!cancelled) {
          setLoadError(message(reason, t("unexpectedError")));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [game.manifestUrl, t]);

  useEffect(() => {
    document.title = `${gameName} | Playweft`;
    return () => {
      document.title = "Playweft";
    };
  }, [gameName]);

  useEffect(() => {
    if (!closing) return;
    setGameInfoOpen(false);
    setGameHelpOpen(false);
  }, [closing]);

  useEffect(() => {
    if (!loaded) return;
    const capabilities = [
      ...new Set([
        ...PLATFORM_WINDOW_CAPABILITIES,
        "user.getProfile",
        "navigator.clipboard.readText",
      ]),
    ];
    const detachBridge = attachGameBridge({
      frame: iframe,
      origin: gameOrigin,
      onBeforeConnect() {
        clipboard.cancelPending();
        userProfile.cancelPending();
        windowDialogs.cancelPending();
      },
      handlers: {
        "game.initialize": {
          handle() {
            if (!loaded.manifest.modes.solo) {
              throw rpcPlatformFault(
                "SOLO_MODE_UNAVAILABLE",
                "The game Manifest does not declare solo mode",
              );
            }
            return {
              mode: "solo",
              protocolVersion: PLAYWEFT_BRIDGE_VERSION,
              capabilities,
              player: {
                ...(nicknameRef.current ? { name: nicknameRef.current } : {}),
              },
            };
          },
        },
        "room.action": {
          handle() {
            throw rpcPlatformFault(
              "ROOM_UNAVAILABLE_IN_SOLO_MODE",
              "Room actions are unavailable in solo mode",
            );
          },
        },
        "navigator.clipboard.readText": {
          handle() {
            return clipboard.requestReadText();
          },
        },
        "room.players.getProfile": {
          handle() {
            throw rpcPlatformFault(
              "ROOM_UNAVAILABLE_IN_SOLO_MODE",
              "Room player profiles are unavailable in solo mode",
            );
          },
        },
        "user.getProfile": {
          handle(params) {
            const fields = userProfileFieldsFromRpcParams(params);
            if (!fields) {
              throw new RpcFault(
                JsonRpcErrorCode.InvalidParams,
                "user.getProfile expects { fields: ['name' | 'avatar', ...] }",
              );
            }
            return userProfile.requestProfile(fields);
          },
        },
        "window.alert": {
          handle: windowDialogs.requestAlert,
        },
        "window.confirm": {
          handle: windowDialogs.requestConfirm,
        },
      },
    });
    return () => {
      clipboard.cancelPending();
      userProfile.cancelPending();
      windowDialogs.cancelPending();
      detachBridge();
    };
  }, [
    clipboard.cancelPending,
    clipboard.requestReadText,
    gameOrigin,
    loaded,
    userProfile.cancelPending,
    userProfile.requestProfile,
    windowDialogs.cancelPending,
    windowDialogs.requestAlert,
    windowDialogs.requestConfirm,
  ]);

  return (
    <div
      className={`room-shell room-playing solo-host ${closing ? "solo-host-closing" : ""}`}
    >
      <GameViewport
        infoExpanded={gameInfoOpen}
        onOpenInfo={() => setGameInfoOpen(true)}
        orientationAction={gameViewport.orientationAction}
        onEnterPreferredOrientation={() =>
          void gameViewport.enterPreferredOrientation()
        }
      >
        {!frameReady && !loadError && (
          <div
            className="solo-loading"
            role="status"
            aria-label={t("loadingGame")}
            aria-live="polite"
          >
            <div className="solo-loading-game">
              {currentGame.icon ? (
                <img
                  className="solo-loading-icon"
                  src={currentGame.icon}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="solo-loading-icon solo-loading-icon-fallback">
                  {gameName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <strong>{gameName}</strong>
            </div>
            <div className="solo-loading-progress">
              <span className="loading-spinner" aria-hidden="true" />
            </div>
          </div>
        )}
        {loaded && (
          <div
            className={`solo-game-surface ${frameReady ? "solo-game-surface-ready" : ""}`}
          >
            <GameFrame
              key={gameRevision}
              ref={iframe}
              title={gameName}
              src={loaded.game.url}
              onLoad={() => setFrameReady(true)}
            />
          </div>
        )}
      </GameViewport>
      {loadError && (
        <ErrorToast
          message={loadError}
          onDismiss={() => setLoadError(undefined)}
        />
      )}
      <ClipboardPrompt
        prompt={clipboard.prompt}
        notice={clipboard.notice}
        onAllow={() => void clipboard.allow()}
        onDeny={clipboard.deny}
        onDismissNotice={clipboard.clearNotice}
      />
      <UserProfilePrompt
        prompt={userProfile.prompt}
        onAllow={userProfile.allow}
        onDeny={userProfile.deny}
      />
      {windowDialogs.dialog && (
        <GameWindowDialog
          dialog={windowDialogs.dialog}
          onConfirm={windowDialogs.confirm}
          onDismiss={windowDialogs.dismiss}
        />
      )}
      {gameInfoOpen && (
        <GameInfoPanel
          actions={[
            {
              label: t("backHome"),
              variant: "primary",
              onSelect: () => {
                setGameInfoOpen(false);
                onBack();
              },
            },
          ]}
          description={gameDescription}
          icon={currentGame.icon}
          isFavorite={isFavorite}
          manifestUrl={currentGame.manifestUrl}
          name={gameName}
          url={currentGame.url}
          onClose={() => setGameInfoOpen(false)}
          onRefresh={
            loaded
              ? () => {
                  setFrameReady(false);
                  setGameRevision((revision) => revision + 1);
                }
              : undefined
          }
          onShowHelp={
            currentGame.helpUrl ? () => setGameHelpOpen(true) : undefined
          }
          onToggleFavorite={() =>
            setIsFavorite(toggleFavoriteGame(currentGame))
          }
        />
      )}
      {gameHelpOpen && currentGame.helpUrl && (
        <GameHelpDialog
          name={gameName}
          url={currentGame.helpUrl}
          onClose={() => setGameHelpOpen(false)}
        />
      )}
    </div>
  );
}

function EntryOverlay({
  status,
  onCancel,
}: {
  status: string;
  onCancel(): void;
}) {
  const { t } = useI18n();
  return (
    <div className="creating-overlay">
      <div className="creating-status" role="status" aria-live="polite">
        <span className="loading-spinner" aria-hidden="true" />
        <span>{status}</span>
      </div>
      <button className="creating-cancel" type="button" onClick={onCancel}>
        {t("cancel")}
      </button>
    </div>
  );
}

interface GameShelfProps {
  title: string;
  kind: GameShelfKind;
  games: ShelfGame[];
  activeGameId?: string;
  getItemClassName?(game: ShelfGame): string;
  onItemAnimationEnd?(game: ShelfGame): void;
  onSelect(game: ShelfGame): void;
  onContextMenu(
    game: ShelfGame,
    kind: GameShelfKind,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void;
}

function GameShelf({
  title,
  kind,
  games,
  activeGameId,
  getItemClassName,
  onItemAnimationEnd,
  onSelect,
  onContextMenu,
}: GameShelfProps) {
  const { locale } = useI18n();
  return (
    <section
      className="game-shelf"
      aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-title`}
    >
      <div className="shelf-heading">
        <h2 id={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>
          {title}
        </h2>
      </div>
      <div className="shelf-row">
        {games.map((game) => (
          <div
            className={`shelf-game-slot ${activeGameId === game.manifestId ? "shelf-game-menu-target" : ""} ${getItemClassName?.(game) ?? ""}`}
            key={game.manifestId}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) {
                onItemAnimationEnd?.(game);
              }
            }}
          >
            <button
              className="shelf-game"
              onClick={() => onSelect(game)}
              onContextMenu={(event) => onContextMenu(game, kind, event)}
            >
              <span className="shelf-art">
                {game.icon ? (
                  <img src={game.icon} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span>
                    {localizeGameName(game, locale).slice(0, 2).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="shelf-game-name">
                {localizeGameName(game, locale)}
              </span>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function LaunchChoiceDialog({
  game,
  roomCode,
  onRoomCodeChange,
  onClose,
  onPlaySolo,
  onCreateRoom,
  onJoinRoom,
}: {
  game: ShelfGame;
  roomCode: string;
  onRoomCodeChange(value: string): void;
  onClose(): void;
  onPlaySolo(): void;
  onCreateRoom(): void;
  onJoinRoom(roomId: string): void;
}) {
  const { locale, t } = useI18n();
  const roomId = roomIdFromInput(roomCode);
  const gameName = localizeGameName(game, locale);
  const [joinRoomOpen, setJoinRoomOpen] = useState(false);
  const roomCodeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!joinRoomOpen) return;
    roomCodeInput.current?.focus();
  }, [joinRoomOpen]);

  return (
    <Dialog title={t("playGame")} contentLayout="flush" onDismiss={onClose}>
      <div className="launch-choice">
        <div className="launch-choice-game">
          <span className="shelf-art">
            {game.icon ? (
              <img src={game.icon} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span>{gameName.slice(0, 2).toUpperCase()}</span>
            )}
          </span>
          <strong>{gameName}</strong>
        </div>
        <hr className="launch-choice-divider" />
        <div
          className={`launch-choice-panels ${
            joinRoomOpen ? "launch-choice-panels-join" : ""
          }`}
        >
          <div className="launch-choice-menu" aria-hidden={joinRoomOpen}>
            <button type="button" disabled={joinRoomOpen} onClick={onPlaySolo}>
              <span>{t("playSolo")}</span>
              <ChevronRight aria-hidden="true" />
            </button>
            <hr className="launch-choice-divider" />
            <button
              type="button"
              disabled={joinRoomOpen}
              onClick={onCreateRoom}
            >
              <span>{t("createRoom")}</span>
              <ChevronRight aria-hidden="true" />
            </button>
            <hr className="launch-choice-divider" />
            <button
              type="button"
              disabled={joinRoomOpen}
              onClick={() => setJoinRoomOpen(true)}
            >
              <span>{t("joinRoom")}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className="launch-choice-join-panel" aria-hidden={!joinRoomOpen}>
            <form
              id="launch-choice-room-form"
              className="launch-choice-join"
              onSubmit={(event) => {
                event.preventDefault();
                if (roomId) onJoinRoom(roomId);
              }}
            >
              <div className="launch-choice-join-field">
                <input
                  ref={roomCodeInput}
                  type="text"
                  disabled={!joinRoomOpen}
                  placeholder={t("enterRoomCode")}
                  value={roomCode}
                  onChange={(event) => onRoomCodeChange(event.target.value)}
                />
              </div>
              <hr className="launch-choice-divider" />
              <div className="launch-choice-join-actions">
                <button
                  type="button"
                  disabled={!joinRoomOpen}
                  onClick={() => setJoinRoomOpen(false)}
                >
                  {t("back")}
                </button>
                <hr className="launch-choice-divider-vertical" />
                <button type="submit" disabled={!joinRoomOpen || !roomId}>
                  {t("joinRoom")}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function UnsupportedGameDialog({
  error,
  url,
  onClose,
}: {
  error: string;
  url: string;
  onClose(): void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      title={t("gameNotSupported")}
      onDismiss={onClose}
      actions={[
        { label: t("back") },
        {
          label: t("openSite"),
          variant: "primary",
          onSelect: () => {
            window.location.href = url;
          },
        },
      ]}
    >
      <div className="unsupported-game">
        <p>{error}</p>
        <span>{url}</span>
      </div>
    </Dialog>
  );
}

function readRecentGames(): RecentGame[] {
  return readStoredRecentGames().map(toRecentGame).slice(0, MAX_RECENT_GAMES);
}

function readStoredRecentGames(): StoredRecentGame[] {
  return readStoredGames(RECENT_GAMES_KEY);
}

function readStoredGames(key: string): StoredRecentGame[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredRecentGame);
  } catch {
    return [];
  }
}

function saveRecentGame(game: RecentGame): void {
  const favorites = readFavoriteGames();
  if (favorites.some((item) => item.manifestId === game.manifestId)) {
    persistFavoriteGames([
      game,
      ...favorites.filter((item) => item.manifestId !== game.manifestId),
    ]);
  }
  const current = readRecentGames();
  persistRecentGames([
    game,
    ...current.filter((item) => item.manifestId !== game.manifestId),
  ]);
}

function persistRecentGames(games: RecentGame[]): RecentGame[] {
  const next = uniqueGames(games).slice(0, MAX_RECENT_GAMES);
  localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(next));
  return next;
}

function uniqueGames(games: RecentGame[]): RecentGame[] {
  const seenIds = new Set<string>();
  return games.filter((game) => {
    if (seenIds.has(game.manifestId)) return false;
    seenIds.add(game.manifestId);
    return true;
  });
}

function isStoredRecentGame(value: unknown): value is StoredRecentGame {
  return (
    isStoredDiscoveredGame(value) &&
    ((value as StoredRecentGame).pinned === undefined ||
      typeof (value as StoredRecentGame).pinned === "boolean")
  );
}

function toRecentGame(game: ShelfGame): RecentGame {
  return {
    ...game,
    url: new URL(game.url, window.location.origin).toString(),
  };
}

function supportedModes(game: ShelfGame): GameMode[] {
  return game.modes;
}

class UnsupportedGameUrlError extends Error {
  constructor(
    readonly url: string,
    message: string,
  ) {
    super(message);
  }
}

function probeGame(
  value: string,
  onStatus: (status: string) => void,
  t: Translator,
): Promise<RecentGame> {
  const manifestUrl = normalizeGameUrl(value, t);
  onStatus(t("checkingGame"));
  return loadGameManifest(manifestUrl)
    .then((loaded) => loaded.game)
    .catch((reason) => {
      throw new UnsupportedGameUrlError(
        manifestUrl,
        reason instanceof Error ? reason.message : t("gameBridgeUnavailable"),
      );
    });
}

function normalizeGameUrl(value: string, t: Translator): string {
  try {
    return manifestUrlFromInput(value);
  } catch {
    throw new Error(t("enterFullGameUrl"));
  }
}

function readAppLocation(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function gameUrlFromExternalLaunch(location: string): string | undefined {
  const url = new URL(location, window.location.origin);
  if (url.pathname !== "/") return undefined;
  const value = url.searchParams.get("game")?.trim();
  if (!value) return undefined;
  return /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
}

function roomIdFromInput(value: string): string | undefined {
  const input = value.trim();
  if (!input) return undefined;
  const format = roomIdFormat(import.meta.env.VITE_ROOM_ID_FORMAT);
  switch (format.kind) {
    case "uuid":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input,
      )
        ? input.toLowerCase()
        : undefined;
    case "digits":
      return new RegExp(`^\\d{${format.length}}$`).test(input)
        ? input
        : undefined;
    case "base64url":
      return new RegExp(`^[A-Za-z0-9_-]{${format.length}}$`).test(input)
        ? input
        : undefined;
    case "code": {
      const uppercased = input.toUpperCase();
      return uppercased.length === format.length &&
        [...uppercased].every((character) => CODE_ALPHABET.includes(character))
        ? uppercased
        : undefined;
    }
  }
}

function roomIdFormat(value: string | undefined): RoomIdFormat {
  const configured = (value?.trim() || DEFAULT_ROOM_ID_FORMAT).toLowerCase();
  if (configured === "uuid") return { kind: "uuid" };
  const match = /^(code|digits|base64url):([1-9]\d{0,2})$/.exec(configured);
  if (!match) return { kind: "code", length: 4 };
  return {
    kind: match[1] as "code" | "digits" | "base64url",
    length: Number(match[2]),
  };
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

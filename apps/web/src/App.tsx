import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createGuestSession, createRoom } from "./platform-api";
import RoomHost from "./RoomHost";
import { useFeaturedGames, type FeaturedGame } from "./featured-games";
import Dialog from "./Dialog";
import ErrorToast from "./ErrorToast";
import GameInfoPanel from "./GameInfoPanel";
import GameMenu from "./GameMenu";
import { ClipboardPrompt, useClipboardRead } from "./ClipboardPrompt";
import {
  PLAYWEFT_BRIDGE_VERSION,
  dispatchRpcMessage,
  rpcPlatformFault,
} from "./json-rpc";
import {
  isStoredDiscoveredGame,
  loadGameManifest,
  manifestUrlFromInput,
  manifestPermissionReason,
  type LoadedGame,
  type DiscoveredGame as RecentGame,
  type GameMode,
} from "./game-manifest";
import type { MenuPosition } from "./Menu";
import { localizeGameName, useI18n, type Translator } from "./i18n";

const RECENT_GAMES_KEY = "playweft:recent-games:v1";
const FAVORITE_GAMES_KEY = "playweft:favorite-games:v1";
const MAX_RECENT_GAMES = 8;
const MAX_FAVORITE_GAMES = 8;
const DEFAULT_ROOM_ID_FORMAT = "code:4";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
type ShelfGame = RecentGame | FeaturedGame;
type GameShelfKind = "favorite" | "recent" | "recommended";
type StoredRecentGame = RecentGame & { pinned?: boolean };
type RoomIdFormat =
  | { kind: "uuid" }
  | { kind: "code" | "digits" | "base64url"; length: number };

export default function App() {
  const { t } = useI18n();
  const [path, setPath] = useState(window.location.pathname);
  const [entryStatus, setEntryStatus] = useState<string>();
  const [settledRoomId, setSettledRoomId] = useState<string>();
  const [soloGame, setSoloGame] = useState<RecentGame>();
  const entryGeneration = useRef(0);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }, []);
  const roomId = /^\/r\/([a-zA-Z0-9_-]{1,128})$/.exec(path)?.[1];

  useEffect(() => {
    if (!roomId) setSettledRoomId(undefined);
  }, [roomId]);

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

  if (soloGame) {
    return <SoloHost game={soloGame} onBack={() => setSoloGame(undefined)} />;
  }

  if (roomId) {
    return (
      <>
        <RoomHost
          key={roomId}
          roomId={roomId}
          onBack={() => navigate("/")}
          onGameDiscovered={saveRecentGame}
          onEntryStatus={setEntryStatus}
          onEntryReady={finishCurrentRoomEntry}
          onEntryFailed={finishCurrentRoomEntry}
        />
        {overlayStatus && (
          <EntryOverlay status={overlayStatus} onCancel={cancelEntry} />
        )}
      </>
    );
  }
  return (
    <>
      <Home
        onNavigate={navigate}
        onBeginEntry={beginEntry}
        onEntryStatus={setEntryStatus}
        onPlaySolo={setSoloGame}
      />
      {overlayStatus && (
        <EntryOverlay status={overlayStatus} onCancel={cancelEntry} />
      )}
    </>
  );
}

interface HomeProps {
  onNavigate(path: string): void;
  onBeginEntry(): () => boolean;
  onEntryStatus(status: string | undefined): void;
  onPlaySolo(game: RecentGame): void;
}

function Home({
  onNavigate,
  onBeginEntry,
  onEntryStatus,
  onPlaySolo,
}: HomeProps) {
  const { locale, t } = useI18n();
  const [gameUrl, setGameUrl] = useState("");
  const [recentGames, setRecentGames] = useState(readRecentGames);
  const [favoriteGames, setFavoriteGames] = useState(readFavoriteGames);
  const featuredGames = useFeaturedGames();
  const [error, setError] = useState<string>();
  const [gameMenu, setGameMenu] = useState<{
    game: ShelfGame;
    kind: GameShelfKind;
    position: MenuPosition;
  }>();
  const [gameInfo, setGameInfo] = useState<ShelfGame>();
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
    setRecentGames(readRecentGames());
    setFavoriteGames(readFavoriteGames());
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
      await createGuestSession();
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
      await createGuestSession();
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
    setFavoriteGames((current) => {
      if (current.some((item) => item.manifestId === game.manifestId)) {
        return persistFavoriteGames(
          current.filter((item) => item.manifestId !== game.manifestId),
        );
      }
      return persistFavoriteGames([
        toRecentGame(game),
        ...current.filter((item) => item.manifestId !== game.manifestId),
      ]);
    });
  };

  const deleteRecent = (game: ShelfGame) => {
    setRecentGames((current) =>
      persistRecentGames(
        current.filter((item) => item.manifestId !== game.manifestId),
      ),
    );
  };

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label={t("playweftHome")}>
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>playweft</span>
        </a>
        <span className="topbar-label">{t("playGamesTogether")}</span>
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

        {favoriteGames.length > 0 && (
          <GameShelf
            title={t("favorites")}
            kind="favorite"
            games={favoriteGames}
            onSelect={launchGame}
            onContextMenu={openGameMenu}
          />
        )}
        {recentGames.length > 0 && (
          <GameShelf
            title={t("recentlyPlayed")}
            kind="recent"
            games={recentGames}
            onSelect={launchGame}
            onContextMenu={openGameMenu}
          />
        )}
        <GameShelf
          title={t("recommended")}
          kind="recommended"
          games={featuredGames}
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
          icon={gameInfo.icon}
          name={localizeGameName(gameInfo, locale)}
          url={gameInfo.url}
          onClose={() => setGameInfo(undefined)}
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

function SoloHost({ game, onBack }: { game: RecentGame; onBack(): void }) {
  const { locale, t } = useI18n();
  const [gameInfoOpen, setGameInfoOpen] = useState(false);
  const [loaded, setLoaded] = useState<LoadedGame>();
  const [loadError, setLoadError] = useState<string>();
  const iframe = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | undefined>(undefined);
  const currentGame = loaded?.game ?? game;
  const gameName = localizeGameName(currentGame, locale);
  const gameOrigin = new URL(currentGame.url).origin;
  const clipboard = useClipboardRead(gameName, gameOrigin);

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
    if (!loaded) return;
    const clipboardDeclared = loaded.game.permissions.includes(
      "clipboard.readText",
    );
    const clipboardReason = manifestPermissionReason(
      loaded.manifest,
      "clipboard.readText",
    );
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== gameOrigin ||
        event.source !== iframe.current?.contentWindow ||
        event.data?.type !== "playweft:bridge-ready" ||
        event.data?.version !== PLAYWEFT_BRIDGE_VERSION
      )
        return;

      clipboard.cancelPending();
      port.current?.close();
      const channel = new MessageChannel();
      port.current = channel.port1;
      channel.port1.onmessage = (bridgeEvent) => {
        void dispatchRpcMessage(channel.port1, bridgeEvent.data, {
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
                capabilities: loaded.game.permissions,
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
          "clipboard.readText": {
            handle() {
              if (!clipboardDeclared) {
                throw rpcPlatformFault(
                  "PERMISSION_NOT_DECLARED",
                  "The game Manifest does not declare clipboard.readText",
                );
              }
              return clipboard.requestReadText(clipboardReason);
            },
          },
        });
      };
      channel.port1.start();
      iframe.current?.contentWindow?.postMessage(
        { type: "playweft:bridge", version: PLAYWEFT_BRIDGE_VERSION },
        gameOrigin,
        [channel.port2],
      );
    };

    window.addEventListener("message", onMessage);
    return () => {
      clipboard.cancelPending();
      port.current?.close();
      port.current = undefined;
      window.removeEventListener("message", onMessage);
    };
  }, [
    clipboard.cancelPending,
    clipboard.requestReadText,
    gameOrigin,
    loaded,
  ]);

  return (
    <div className="room-shell room-playing solo-host">
      {loaded && (
        <iframe
          ref={iframe}
          className="game-frame"
          title={gameName}
          src={loaded.game.url}
          sandbox="allow-scripts allow-same-origin allow-forms"
          allow="clipboard-read 'none'; clipboard-write 'none'"
        />
      )}
      {loadError && (
        <ErrorToast message={loadError} onDismiss={() => setLoadError(undefined)} />
      )}
      <ClipboardPrompt
        prompt={clipboard.prompt}
        notice={clipboard.notice}
        onAllow={() => void clipboard.allow()}
        onDeny={clipboard.deny}
        onDismissNotice={clipboard.clearNotice}
      />
      <button
        className="game-options"
        type="button"
        aria-label={t("gameInformation")}
        aria-expanded={gameInfoOpen}
        onClick={() => setGameInfoOpen(true)}
      >
        <i />
        <i />
        <i />
      </button>
      {gameInfoOpen && (
        <GameInfoPanel
          actions={[
            {
              label: t("backHome"),
              variant: "primary",
              onSelect: onBack,
            },
          ]}
          icon={currentGame.icon}
          name={gameName}
          url={currentGame.url}
          onClose={() => setGameInfoOpen(false)}
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
          <button
            className="shelf-game"
            key={game.manifestId}
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

  return (
    <Dialog title={t("playGame")} onDismiss={onClose}>
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
        <div className="launch-choice-actions">
          <button type="button" onClick={onPlaySolo}>
            {t("playSolo")}
          </button>
          <button type="button" onClick={onCreateRoom}>
            {t("createRoom")}
          </button>
        </div>
        <form
          className="launch-choice-join"
          onSubmit={(event) => {
            event.preventDefault();
            if (roomId) onJoinRoom(roomId);
          }}
        >
          <input
            type="text"
            placeholder={t("enterRoomCode")}
            value={roomCode}
            onChange={(event) => onRoomCodeChange(event.target.value)}
          />
          <button type="submit" disabled={!roomId}>
            {t("joinRoom")}
          </button>
        </form>
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

function readFavoriteGames(): RecentGame[] {
  const savedFavorites = readStoredGames(FAVORITE_GAMES_KEY).map(toRecentGame);
  const pinnedFavorites = readStoredRecentGames()
    .filter((game) => game.pinned)
    .map(toRecentGame);
  const favorites = uniqueGames([...savedFavorites, ...pinnedFavorites]).slice(
    0,
    MAX_FAVORITE_GAMES,
  );
  if (pinnedFavorites.length > 0) persistFavoriteGames(favorites);
  return favorites;
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

function persistFavoriteGames(games: RecentGame[]): RecentGame[] {
  const next = uniqueGames(games).slice(0, MAX_FAVORITE_GAMES);
  localStorage.setItem(FAVORITE_GAMES_KEY, JSON.stringify(next));
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
  return loadGameManifest(manifestUrl).then((loaded) => loaded.game).catch((reason) => {
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

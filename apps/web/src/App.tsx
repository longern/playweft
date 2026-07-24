import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createGuestSession, createRoom } from "./platform-api";
import RoomHost, { type GameMode, type RecentGame } from "./RoomHost";
import { FEATURED_GAMES, type FeaturedGame } from "./featured-games";
import Dialog from "./Dialog";
import ErrorToast from "./ErrorToast";
import GameInfoPanel from "./GameInfoPanel";
import GameMenu from "./GameMenu";
import type { MenuPosition } from "./Menu";
import { isGameTranslations, localizeGameName, useI18n, type Translator } from "./i18n";

const RECENT_GAMES_KEY = "playweft:recent-games:v1";
const FAVORITE_GAMES_KEY = "playweft:favorite-games:v1";
const MAX_RECENT_GAMES = 8;
const MAX_FAVORITE_GAMES = 8;
const DEFAULT_ROOM_ID_FORMAT = "code:4";
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const GAME_PROBE_TIMEOUT_MS = 8_000;
const GAME_PROBE_METADATA_TIMEOUT_MS = 2_000;
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
    return (
      <SoloHost game={soloGame} onBack={() => setSoloGame(undefined)} />
    );
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
  const favoriteUrls = useMemo(
    () => new Set(favoriteGames.map((game) => game.url)),
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
      const room = await createRoom(game.url);
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
      const game = await probeGame(trimmed, (status) => onEntryStatus(status), t);
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
      if (current.some((item) => item.url === game.url)) {
        return persistFavoriteGames(
          current.filter((item) => item.url !== game.url),
        );
      }
      return persistFavoriteGames([
        toRecentGame(game),
        ...current.filter((item) => item.url !== game.url),
      ]);
    });
  };

  const deleteRecent = (game: ShelfGame) => {
    setRecentGames((current) =>
      persistRecentGames(current.filter((item) => item.url !== game.url)),
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
          games={FEATURED_GAMES}
          onSelect={launchGame}
          onContextMenu={openGameMenu}
        />
      </main>
      {error && (
        <ErrorToast message={error} onDismiss={() => setError(undefined)} />
      )}
      {gameMenu && (
        <GameMenu
          key={`${gameMenu.game.url}:${gameMenu.kind}`}
          game={gameMenu.game}
          position={gameMenu.position}
          isFavorite={favoriteUrls.has(gameMenu.game.url)}
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

function SoloHost({
  game,
  onBack,
}: {
  game: RecentGame;
  onBack(): void;
}) {
  const { locale, t } = useI18n();
  const [gameInfoOpen, setGameInfoOpen] = useState(false);
  const gameName = localizeGameName(game, locale);

  useEffect(() => {
    document.title = `${gameName} | Playweft`;
    return () => {
      document.title = "Playweft";
    };
  }, [gameName]);

  return (
    <div className="room-shell room-playing solo-host">
      <iframe
        className="game-frame"
        title={gameName}
        src={game.url}
        sandbox="allow-scripts allow-same-origin"
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
          icon={game.icon}
          name={gameName}
          url={game.url}
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
            key={game.url}
            onClick={() => onSelect(game)}
            onContextMenu={(event) => onContextMenu(game, kind, event)}
          >
            <span className="shelf-art">
              {game.icon ? (
                <img src={game.icon} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span>{localizeGameName(game, locale).slice(0, 2).toUpperCase()}</span>
              )}
            </span>
            <span className="shelf-game-name">{localizeGameName(game, locale)}</span>
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
  if (favorites.some((item) => item.url === game.url)) {
    persistFavoriteGames([
      game,
      ...favorites.filter((item) => item.url !== game.url),
    ]);
  }
  const current = readRecentGames();
  persistRecentGames([
    game,
    ...current.filter((item) => item.url !== game.url),
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
  const seenUrls = new Set<string>();
  return games.filter((game) => {
    if (seenUrls.has(game.url)) return false;
    seenUrls.add(game.url);
    return true;
  });
}

function isStoredRecentGame(value: unknown): value is StoredRecentGame {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.url === "string" &&
    typeof item.name === "string" &&
    (item.translations === undefined || isGameTranslations(item.translations)) &&
    (item.icon === undefined || typeof item.icon === "string") &&
    (item.helpUrl === undefined || typeof item.helpUrl === "string") &&
    (item.modes === undefined || isGameModes(item.modes)) &&
    (item.liveRoom === undefined || typeof item.liveRoom === "boolean") &&
    (item.pinned === undefined || typeof item.pinned === "boolean")
  );
}

function toRecentGame(game: ShelfGame): RecentGame {
  return {
    url: game.url,
    name: game.name,
    ...(game.translations ? { translations: game.translations } : {}),
    ...(game.icon ? { icon: game.icon } : {}),
    ...("helpUrl" in game && game.helpUrl ? { helpUrl: game.helpUrl } : {}),
    ...(game.modes ? { modes: supportedModes(game) } : {}),
    ...(game.liveRoom ? { liveRoom: true } : {}),
  };
}

function supportedModes(game: ShelfGame): GameMode[] {
  return game.modes && game.modes.length > 0 ? game.modes : ["room"];
}

function isGameModes(value: unknown): value is GameMode[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => item === "solo" || item === "room")
  );
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
  const gameUrl = normalizeGameUrl(value, t);
  const gameOrigin = new URL(gameUrl).origin;
  onStatus(t("checkingGame"));
  return new Promise((resolve, reject) => {
    let settled = false;
    let bridgeReady = false;
    let descriptorGame: RecentGame | undefined;
    let metadataTimer: number | undefined;
    let port: MessagePort | undefined;
    const iframe = document.createElement("iframe");
    iframe.src = gameUrl;
    iframe.title = t("gameCompatibilityCheck");
    iframe.tabIndex = -1;
    iframe.setAttribute("aria-hidden", "true");
    iframe.className = "game-probe-frame";

    const cleanup = () => {
      window.clearTimeout(timeout);
      window.clearTimeout(metadataTimer);
      window.removeEventListener("message", onMessage);
      port?.close();
      iframe.remove();
    };
    const finish = (game: RecentGame) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(game);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const fallbackGame = (): RecentGame => ({
      url: gameUrl,
      name: gameNameFromUrl(gameUrl),
      modes: ["room"],
    });
    const timeout = window.setTimeout(() => {
      fail(
        new UnsupportedGameUrlError(
          gameUrl,
          bridgeReady
            ? t("gameLaunchMissing")
            : t("gameBridgeUnavailable"),
        ),
      );
    }, GAME_PROBE_TIMEOUT_MS);
    const onPortMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type === "descriptor") {
        const game = gameDescriptor(data.descriptor, gameOrigin, gameUrl);
        if (!game) return;
        descriptorGame = game;
        const modes = supportedModes(game);
        if (modes.includes("solo")) finish(game);
        return;
      }
      if (data?.type === "initialize") {
        const liveRoom =
          data.initialization !== null &&
          typeof data.initialization === "object" &&
          !Array.isArray(data.initialization) &&
          (data.initialization as Record<string, unknown>).liveRoom === true;
        const game = descriptorGame ?? fallbackGame();
        finish({
          ...game,
          modes: supportedModes(game).includes("room")
            ? supportedModes(game)
            : [...supportedModes(game), "room"],
          ...(liveRoom ? { liveRoom: true } : {}),
        });
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (settled) return;
      if (event.origin !== gameOrigin) return;
      if (event.source !== iframe.contentWindow) return;
      if (
        event.data?.type !== "playweft:bridge-ready" ||
        event.data?.version !== 1
      )
        return;
      bridgeReady = true;
      const channel = new MessageChannel();
      port = channel.port1;
      channel.port1.onmessage = onPortMessage;
      channel.port1.start();
      iframe.contentWindow?.postMessage(
        { type: "playweft:bridge", version: 1 },
        gameOrigin,
        [channel.port2],
      );
      metadataTimer = window.setTimeout(() => {
        if (descriptorGame) {
          finish(descriptorGame);
          return;
        }
        fail(
          new UnsupportedGameUrlError(
            gameUrl,
            t("gameBridgeLaunchMissing"),
          ),
        );
      }, GAME_PROBE_METADATA_TIMEOUT_MS);
    };

    window.addEventListener("message", onMessage);
    document.body.append(iframe);
  });
}

function normalizeGameUrl(value: string, t: Translator): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(t("enterFullGameUrl"));
  }
}

function gameDescriptor(
  value: unknown,
  gameOrigin: string,
  gameUrl: string,
): RecentGame | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (
    typeof input.name !== "string" ||
    input.name.length === 0 ||
    input.name.length > 100
  )
    return undefined;
  let icon: string | undefined;
  let helpUrl: string | undefined;
  const translations = isGameTranslations(input.translations)
    ? input.translations
    : undefined;
  if (typeof input.icon === "string") {
    try {
      const resolved = new URL(input.icon, gameUrl);
      if (resolved.origin === gameOrigin) icon = resolved.toString();
    } catch {
      // Optional metadata.
    }
  }
  if (typeof input.helpUrl === "string") {
    try {
      const resolved = new URL(input.helpUrl, gameUrl);
      if (resolved.origin === gameOrigin) helpUrl = resolved.toString();
    } catch {
      // Optional metadata.
    }
  }
  const modes = isGameModes(input.modes)
    ? [...new Set(input.modes)]
    : undefined;
  const liveRoom = input.liveRoom === true;
  return {
    url: gameUrl,
    name: input.name,
    ...(translations ? { translations } : {}),
    ...(icon ? { icon } : {}),
    ...(helpUrl ? { helpUrl } : {}),
    ...(modes ? { modes } : {}),
    ...(liveRoom ? { liveRoom } : {}),
  };
}

function gameNameFromUrl(value: string): string {
  const url = new URL(value);
  const segment = url.pathname.split("/").filter(Boolean).at(-1);
  return segment ? decodeURIComponent(segment) : url.hostname;
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

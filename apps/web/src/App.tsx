import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createGuestSession, createRoom } from "./platform-api";
import RoomHost, { type RecentGame } from "./RoomHost";
import { FEATURED_GAMES, type FeaturedGame } from "./featured-games";
import ErrorToast from "./ErrorToast";
import GameInfoPanel from "./GameInfoPanel";
import GameMenu from "./GameMenu";
import type { MenuPosition } from "./Menu";

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
  const [path, setPath] = useState(window.location.pathname);
  const [entryStatus, setEntryStatus] = useState<string>();
  const [settledRoomId, setSettledRoomId] = useState<string>();
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
    setEntryStatus("Creating room");
    return () => entryGeneration.current !== generation;
  }, []);

  const cancelEntry = useCallback(() => {
    entryGeneration.current += 1;
    setEntryStatus(undefined);
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
    (roomId && settledRoomId !== roomId ? "Loading game" : undefined);

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
}

function Home({ onNavigate, onBeginEntry, onEntryStatus }: HomeProps) {
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
  const favoriteUrls = useMemo(
    () => new Set(favoriteGames.map((game) => game.url)),
    [favoriteGames],
  );
  const roomIdInput = roomIdFromInput(gameUrl);

  const create = async (url = gameUrl) => {
    const trimmed = url.trim();
    const roomId = roomIdFromInput(trimmed);
    const cancelled = onBeginEntry();
    setError(undefined);
    try {
      await createGuestSession();
      if (cancelled()) return;
      if (roomId) {
        onEntryStatus("Loading game");
        onNavigate(`/r/${roomId}`);
        return;
      }
      const room = await createRoom(trimmed);
      if (cancelled()) return;
      onEntryStatus("Loading game");
      onNavigate(`/r/${room.roomId}`);
    } catch (reason) {
      if (cancelled()) return;
      onEntryStatus(undefined);
      setError(message(reason));
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
        <a className="brand" href="/" aria-label="Playweft home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>playweft</span>
        </a>
        <span className="topbar-label">Play games together</span>
      </header>
      <main className="home">
        <section
          className="launch-section"
          id="new-room"
          aria-labelledby="launch-title"
        >
          <h1 id="launch-title" className="sr-only">
            Create a room
          </h1>
          <form
            className="launch-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="sr-only" htmlFor="game-url">
              Game URL or room code
            </label>
            <div className="url-input">
              <span className="url-icon" aria-hidden="true">
                ⌁
              </span>
              <input
                id="game-url"
                type="text"
                required
                placeholder="Paste a static game URL or room code"
                value={gameUrl}
                onChange={(event) => setGameUrl(event.target.value)}
              />
            </div>
            <button
              className="button primary"
              disabled={!gameUrl.trim()}
              type="submit"
            >
              {roomIdInput ? "Join room" : "Create room"}
            </button>
          </form>
        </section>

        {favoriteGames.length > 0 && (
          <GameShelf
            title="Favorites"
            kind="favorite"
            games={favoriteGames}
            onSelect={(url) => void create(url)}
            onContextMenu={openGameMenu}
          />
        )}
        {recentGames.length > 0 && (
          <GameShelf
            title="Recently played"
            kind="recent"
            games={recentGames}
            onSelect={(url) => void create(url)}
            onContextMenu={openGameMenu}
          />
        )}
        <GameShelf
          title="Recommended"
          kind="recommended"
          games={FEATURED_GAMES}
          onSelect={(url) => void create(url)}
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
          name={gameInfo.name}
          url={gameInfo.url}
          onClose={() => setGameInfo(undefined)}
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
  return (
    <div className="creating-overlay">
      <div className="creating-status" role="status" aria-live="polite">
        <span className="loading-spinner" aria-hidden="true" />
        <span>{status}</span>
      </div>
      <button className="creating-cancel" type="button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

interface GameShelfProps {
  title: string;
  kind: GameShelfKind;
  games: ShelfGame[];
  onSelect(url: string): void;
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
            onClick={() => onSelect(game.url)}
            onContextMenu={(event) => onContextMenu(game, kind, event)}
          >
            <span className="shelf-art">
              {game.icon ? (
                <img src={game.icon} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span>{game.name.slice(0, 2).toUpperCase()}</span>
              )}
            </span>
            <span className="shelf-game-name">{game.name}</span>
          </button>
        ))}
      </div>
    </section>
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
    (item.icon === undefined || typeof item.icon === "string") &&
    (item.helpUrl === undefined || typeof item.helpUrl === "string") &&
    (item.pinned === undefined || typeof item.pinned === "boolean")
  );
}

function toRecentGame(game: ShelfGame): RecentGame {
  return {
    url: game.url,
    name: game.name,
    ...(game.icon ? { icon: game.icon } : {}),
    ...("helpUrl" in game && game.helpUrl ? { helpUrl: game.helpUrl } : {}),
  };
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

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unexpected error";
}

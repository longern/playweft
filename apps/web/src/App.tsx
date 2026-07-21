import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createGuestSession, createRoom } from "./platform-api";
import RoomHost, { type RecentGame } from "./RoomHost";
import { FEATURED_GAMES } from "./featured-games";
import ErrorToast from "./ErrorToast";
import RecentGameMenu from "./RecentGameMenu";

const RECENT_GAMES_KEY = "playweft:recent-games:v1";

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

  const overlayStatus = entryStatus ?? (roomId && settledRoomId !== roomId ? "Loading game" : undefined);

  if (roomId) {
    return <>
      <RoomHost
        key={roomId}
        roomId={roomId}
        onBack={() => navigate("/")}
        onGameDiscovered={saveRecentGame}
        onEntryStatus={setEntryStatus}
        onEntryReady={finishCurrentRoomEntry}
        onEntryFailed={finishCurrentRoomEntry}
      />
      {overlayStatus && <EntryOverlay status={overlayStatus} onCancel={cancelEntry} />}
    </>;
  }
  return <>
    <Home onNavigate={navigate} onBeginEntry={beginEntry} onEntryStatus={setEntryStatus} />
    {overlayStatus && <EntryOverlay status={overlayStatus} onCancel={cancelEntry} />}
  </>;
}

interface HomeProps {
  onNavigate(path: string): void;
  onBeginEntry(): () => boolean;
  onEntryStatus(status: string | undefined): void;
}

function Home({ onNavigate, onBeginEntry, onEntryStatus }: HomeProps) {
  const [gameUrl, setGameUrl] = useState("");
  const [recentGames, setRecentGames] = useState(readRecentGames);
  const [error, setError] = useState<string>();
  const [recentMenu, setRecentMenu] = useState<{ game: RecentGame; x: number; y: number }>();

  const create = async (url = gameUrl) => {
    const cancelled = onBeginEntry();
    setError(undefined);
    try {
      await createGuestSession();
      if (cancelled()) return;
      const room = await createRoom(url);
      if (cancelled()) return;
      onEntryStatus("Loading game");
      onNavigate(`/r/${room.roomId}`);
    } catch (reason) {
      if (cancelled()) return;
      onEntryStatus(undefined);
      setError(message(reason));
    }
  };

  const openRecentMenu = (game: RecentGame, event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.focus();
    const menuWidth = 184;
    const menuHeight = 92;
    const gutter = 8;
    setRecentMenu({
      game,
      x: Math.max(gutter, Math.min(event.clientX, window.innerWidth - menuWidth - gutter)),
      y: Math.max(gutter, Math.min(event.clientY, window.innerHeight - menuHeight - gutter)),
    });
  };

  const togglePinned = (game: RecentGame) => {
    setRecentGames((current) => persistRecentGames(current.map((item) => item.url === game.url ? { ...item, pinned: !item.pinned } : item)));
  };

  const deleteRecent = (game: RecentGame) => {
    setRecentGames((current) => persistRecentGames(current.filter((item) => item.url !== game.url)));
  };

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Playweft home"><span className="brand-mark"><i /><i /><i /></span><span>playweft</span></a>
        <span className="topbar-label">Play games together</span>
      </header>
      <main className="home">
        <section className="launch-section" id="new-room" aria-labelledby="launch-title">
          <h1 id="launch-title" className="sr-only">Create a room</h1>
          <form className="launch-form" onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <label className="sr-only" htmlFor="game-url">Game URL</label>
            <div className="url-input"><span className="url-icon" aria-hidden="true">⌁</span><input id="game-url" type="url" required placeholder="Paste a static game URL" value={gameUrl} onChange={(event) => setGameUrl(event.target.value)} /></div>
            <button className="button primary" disabled={!gameUrl} type="submit">Create room</button>
          </form>
        </section>

        {recentGames.length > 0 && <GameShelf title="Recently played" games={recentGames} onSelect={(url) => void create(url)} onContextMenu={openRecentMenu} recent />}
        <GameShelf title="Recommended" games={FEATURED_GAMES} onSelect={(url) => void create(url)} />
      </main>
      {error && <ErrorToast message={error} onDismiss={() => setError(undefined)} />}
      {recentMenu && <RecentGameMenu
        key={`${recentMenu.game.url}:${recentMenu.x}:${recentMenu.y}`}
        game={recentMenu.game}
        x={recentMenu.x}
        y={recentMenu.y}
        onClose={() => setRecentMenu(undefined)}
        onTogglePinned={() => togglePinned(recentMenu.game)}
        onDelete={() => deleteRecent(recentMenu.game)}
      />}
    </div>
  );
}

function EntryOverlay({ status, onCancel }: { status: string; onCancel(): void }) {
  return <div className="creating-overlay">
    <div className="creating-status" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{status}</span>
    </div>
    <button className="creating-cancel" type="button" onClick={onCancel}>Cancel</button>
  </div>;
}

interface GameShelfProps {
  title: string;
  games: Array<RecentGame | typeof FEATURED_GAMES[number]>;
  onSelect(url: string): void;
  onContextMenu?(game: RecentGame, event: ReactMouseEvent<HTMLButtonElement>): void;
  recent?: boolean;
}

function GameShelf({ title, games, onSelect, onContextMenu, recent = false }: GameShelfProps) {
  return <section className="game-shelf" aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>
    <div className="shelf-heading"><h2 id={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>{title}</h2></div>
    <div className="shelf-row">
      {games.map((game) => <button className="shelf-game" key={game.url} onClick={() => onSelect(game.url)} onContextMenu={recent ? (event) => onContextMenu?.(game as RecentGame, event) : undefined}>
        <span className="shelf-art">{game.icon ? <img src={game.icon} alt="" referrerPolicy="no-referrer" /> : <span>{game.name.slice(0, 2).toUpperCase()}</span>}</span>
        <span className="shelf-game-name">{game.name}</span>
        <span className="shelf-game-meta">{"category" in game && !recent ? game.category : hostname(game.url)}</span>
      </button>)}
    </div>
  </section>;
}

function readRecentGames(): RecentGame[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_GAMES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return orderRecentGames(parsed.filter(isRecentGame)).slice(0, 8);
  } catch {
    return [];
  }
}

function saveRecentGame(game: RecentGame): void {
  const current = readRecentGames();
  const existing = current.find((item) => item.url === game.url);
  persistRecentGames([{ ...game, pinned: existing?.pinned }, ...current.filter((item) => item.url !== game.url)]);
}

function persistRecentGames(games: RecentGame[]): RecentGame[] {
  const next = orderRecentGames(games).slice(0, 8);
  localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(next));
  return next;
}

function orderRecentGames(games: RecentGame[]): RecentGame[] {
  return [...games.filter((game) => game.pinned), ...games.filter((game) => !game.pinned)];
}

function isRecentGame(value: unknown): value is RecentGame {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.url === "string"
    && typeof item.name === "string"
    && (item.icon === undefined || typeof item.icon === "string")
    && (item.pinned === undefined || typeof item.pinned === "boolean");
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unexpected error";
}

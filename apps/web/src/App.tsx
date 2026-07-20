import { useEffect, useRef, useState } from "react";
import { createGuestSession, createRoom } from "./platform-api";
import RoomHost, { type RecentGame } from "./RoomHost";
import { FEATURED_GAMES } from "./featured-games";

const RECENT_GAMES_KEY = "playweft:recent-games:v1";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  };
  const roomId = /^\/r\/([a-zA-Z0-9_-]{1,128})$/.exec(path)?.[1];
  if (roomId) {
    return <RoomHost roomId={roomId} onBack={() => navigate("/")} onGameDiscovered={saveRecentGame} />;
  }
  return <Home onNavigate={navigate} />;
}

function Home({ onNavigate }: { onNavigate(path: string): void }) {
  const [gameUrl, setGameUrl] = useState("");
  const [recentGames, setRecentGames] = useState(readRecentGames);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const create = async (url = gameUrl) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError(undefined);
    try {
      await createGuestSession();
      const room = await createRoom(url);
      const game: RecentGame = { url: room.gameUrl, name: hostname(room.gameUrl) };
      saveRecentGame(game);
      setRecentGames(readRecentGames());
      onNavigate(`/r/${room.roomId}`);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setCreating(false);
      creatingRef.current = false;
    }
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
          {error && <p className="error" role="alert">{error}</p>}
        </section>

        <GameShelf title="Recommended" games={FEATURED_GAMES} onSelect={(url) => void create(url)} />
        {recentGames.length > 0 && <GameShelf title="Recently played" games={recentGames} onSelect={(url) => void create(url)} recent />}
      </main>
      {creating && <div className="creating-overlay" role="status" aria-live="polite"><span className="loading-spinner" aria-hidden="true" /><span>Creating room</span></div>}
    </div>
  );
}

function GameShelf({ title, games, onSelect, recent = false }: { title: string; games: Array<RecentGame | typeof FEATURED_GAMES[number]>; onSelect(url: string): void; recent?: boolean }) {
  return <section className="game-shelf" aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>
    <div className="shelf-heading"><h2 id={`${title.toLowerCase().replaceAll(" ", "-")}-title`}>{title}</h2></div>
    <div className="shelf-row">
      {games.map((game) => <button className="shelf-game" key={game.url} onClick={() => onSelect(game.url)}>
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
    return parsed.filter(isRecentGame).slice(0, 8);
  } catch {
    return [];
  }
}

function saveRecentGame(game: RecentGame): void {
  const next = [game, ...readRecentGames().filter((item) => item.url !== game.url)].slice(0, 8);
  localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(next));
}

function isRecentGame(value: unknown): value is RecentGame {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.url === "string" && typeof item.name === "string" && (item.icon === undefined || typeof item.icon === "string");
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unexpected error";
}

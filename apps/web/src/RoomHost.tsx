import { useEffect, useRef, useState } from "react";
import {
  connectRoom,
  createGuestSession,
  getRoomLaunch,
  initializeRoom,
  joinRoom,
  kickPlayer,
  sendAction,
  startRoom,
  type RoomInitialization,
  type RoomJoin,
  type RoomLobby,
  type RoomSnapshot,
} from "./platform-api";

export interface RecentGame {
  url: string;
  name: string;
  icon?: string;
}

interface RoomHostProps {
  roomId: string;
  onBack(): void;
  onGameDiscovered(game: RecentGame): void;
}

export default function RoomHost({ roomId, onBack, onGameDiscovered }: RoomHostProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const bridgePort = useRef<MessagePort | undefined>(undefined);
  const phaseRef = useRef<"lobby" | "playing">("lobby");
  const [gameUrl, setGameUrl] = useState<string>();
  const [gameName, setGameName] = useState("Game room");
  const [status, setStatus] = useState("Loading room…");
  const [lobby, setLobby] = useState<RoomLobby>();
  const [selfId, setSelfId] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  const phase = lobby?.phase ?? "lobby";
  phaseRef.current = phase;
  const isOwner = Boolean(selfId && lobby?.ownerId === selfId);

  useEffect(() => {
    document.title = `${gameName} | Playweft`;
    return () => { document.title = "Playweft"; };
  }, [gameName]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await createGuestSession();
        const launch = await getRoomLaunch(roomId);
        if (cancelled) return;
        setGameUrl(launch.gameUrl);
        setGameName(hostname(launch.gameUrl));
        setStatus("Loading game information…");
      } catch (reason) {
        if (!cancelled) setStatus(`Error: ${message(reason)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [roomId]);

  useEffect(() => {
    if (!gameUrl) return;
    let socket: WebSocket | undefined;
    let closed = false;
    let roomInitializing = false;
    let joined = false;
    const gameOrigin = new URL(gameUrl).origin;

    const publish = (snapshot: RoomSnapshot) => {
      bridgePort.current?.postMessage({ type: "state", state: snapshot.state });
    };

    const connect = () => {
      socket?.close();
      socket = connectRoom(roomId);
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data as string) as RoomSnapshot | RoomLobby | { type: "error"; error: string };
        if (payload.type === "error") {
          setStatus(`Error: ${payload.error}`);
        } else if (payload.type === "lobby") {
          setLobby(payload);
          setStatus("Waiting for the host to start the game");
        } else {
          publish(payload);
          setLobby((current) => current ? { ...current, phase: "playing" } : current);
          setStatus("Game in progress");
        }
      };
      socket.onerror = () => setStatus("Live connection to the platform failed");
    };

    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin !== gameOrigin || event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type !== "playweft:bridge-ready" || event.data?.version !== 1) return;

      bridgePort.current?.close();
      const channel = new MessageChannel();
      bridgePort.current = channel.port1;
      channel.port1.onmessage = async (bridgeEvent) => {
        const data = bridgeEvent.data;
        if (data?.type === "descriptor") {
          const game = descriptor(data.descriptor, gameOrigin, gameUrl);
          if (!game) return;
          setGameName(game.name);
          onGameDiscovered(game);
          return;
        }
        if (data?.type === "initialize") {
          if (roomInitializing || joined) return;
          roomInitializing = true;
          try {
            await initializeRoom(roomId, initialization(data.initialization));
            const membership = await joinRoom(roomId);
            if (closed) return;
            applyMembership(membership, setLobby, setSelfId);
            joined = true;
            setStatus("Waiting for players to join");
            connect();
          } catch (reason) {
            setStatus(`Error: ${message(reason)}`);
            channel.port1.postMessage({ type: "error", error: message(reason) });
          }
          return;
        }
        if (data?.type !== "action") return;
        if (!joined || phaseRef.current === "lobby") {
          channel.port1.postMessage({ type: "error", error: "The game has not started" });
          return;
        }
        try {
          publish(await sendAction(roomId, data.action));
        } catch (reason) {
          channel.port1.postMessage({ type: "error", error: message(reason) });
        }
      };
      channel.port1.start();
      iframe.current?.contentWindow?.postMessage({ type: "playweft:bridge", version: 1 }, gameOrigin, [channel.port2]);
    };

    window.addEventListener("message", onWindowMessage);
    return () => {
      closed = true;
      socket?.close();
      bridgePort.current?.close();
      bridgePort.current = undefined;
      window.removeEventListener("message", onWindowMessage);
    };
  }, [gameUrl, onGameDiscovered, roomId]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setStatus("Could not copy automatically. Copy the invite link from the address bar.");
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      const snapshot = await startRoom(roomId);
      bridgePort.current?.postMessage({ type: "state", state: snapshot.state });
      setLobby((current) => current ? { ...current, phase: "playing" } : current);
      setStatus("Game in progress");
    } catch (reason) {
      setStatus(`Error: ${message(reason)}`);
    } finally {
      setStarting(false);
    }
  };

  const kick = async (playerId: string) => {
    try {
      const nextLobby = await kickPlayer(roomId, playerId);
      setLobby(nextLobby);
    } catch (reason) {
      setStatus(`Error: ${message(reason)}`);
    }
  };

  return (
    <main className={`room-host ${phase === "playing" ? "room-playing" : ""}`}>
      {phase === "lobby" && <>
        <header>
          <p className="eyebrow">Playweft room</p>
          <h1>{gameName}</h1>
          <p>{status}</p>
        </header>
        <section className="lobby-card" aria-live="polite">
          <div className="lobby-heading"><div><h2>Lobby</h2><p>{lobby ? `${lobby.players.length} / ${lobby.maxPlayers} players · ${lobby.minPlayers} required to start` : "Connecting to room…"}</p></div></div>
          <ol className="player-list">
            {(lobby?.players ?? []).map((player, index) => <li key={player.id}>
              <span>Player {index + 1}{player.id === selfId ? " (you)" : ""}{player.id === lobby?.ownerId ? " · Host" : ""}</span>
              {isOwner && player.id !== selfId && <button onClick={() => void kick(player.id)}>Remove</button>}
            </li>)}
          </ol>
          {isOwner ? <button className="primary" disabled={starting || !lobby || lobby.players.length < lobby.minPlayers} onClick={() => void start()}>{starting ? "Starting…" : "Start game"}</button> : <p className="lobby-note">Waiting for the host to start the game.</p>}
        </section>
        <div className="room-actions">
          <button onClick={onBack}>Create another room</button>
          <button className="primary compact" onClick={() => void copyInvite()}>{copied ? "Invite link copied" : "Copy invite link"}</button>
        </div>
      </>}
      {gameUrl && <iframe className="game-frame" ref={iframe} title={gameName} src={gameUrl} sandbox="allow-scripts allow-same-origin" />}
    </main>
  );
}

function applyMembership(membership: RoomJoin, setLobby: (lobby: RoomLobby) => void, setSelfId: (id: string) => void): void {
  const { selfId, ...lobby } = membership;
  setSelfId(selfId);
  setLobby(lobby);
}

function initialization(value: unknown): RoomInitialization {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid game initialization message");
  }
  const input = value as Record<string, unknown>;
  if (input.runtime !== "lua" || typeof input.script !== "string" || !isLimit(input.minPlayers) || !isLimit(input.maxPlayers) || input.minPlayers > input.maxPlayers) {
    throw new Error("The game must provide a Lua script and valid minPlayers / maxPlayers");
  }
  return { runtime: "lua", script: input.script, minPlayers: input.minPlayers, maxPlayers: input.maxPlayers };
}

function isLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 32;
}

function descriptor(value: unknown, gameOrigin: string, gameUrl: string): RecentGame | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || input.name.length === 0 || input.name.length > 100) return undefined;
  let icon: string | undefined;
  if (typeof input.icon === "string") {
    try {
      const resolved = new URL(input.icon, gameUrl);
      if (resolved.origin === gameOrigin) icon = resolved.toString();
    } catch {
      // Icon metadata is optional.
    }
  }
  return { url: gameUrl, name: input.name, icon };
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return "Game room"; }
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unexpected error";
}

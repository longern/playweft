import { useEffect, useRef, useState } from "react";
import { Armchair, Check, Crown, MoreHorizontal, Plus } from "lucide-react";
import {
  connectRoom,
  createGuestSession,
  getRoomLaunch,
  initializeRoom,
  joinRoom,
  kickPlayer,
  leaveRoom,
  setPlayerReady,
  setRoomSeat,
  sendAction,
  startRoom,
  type RoomInitialization,
  type RoomJoin,
  type RoomLobby,
  type RoomSnapshot,
} from "./platform-api";
import ErrorToast from "./ErrorToast";
import Dialog from "./Dialog";
import InviteDialog from "./InviteDialog";

export interface RecentGame {
  url: string;
  name: string;
  icon?: string;
  pinned?: boolean;
}

interface RoomHostProps {
  roomId: string;
  onBack(): void;
  onGameDiscovered(game: RecentGame): void;
  onEntryStatus(status: string): void;
  onEntryReady(): void;
  onEntryFailed(): void;
}

export default function RoomHost({
  roomId,
  onBack,
  onGameDiscovered,
  onEntryStatus,
  onEntryReady,
  onEntryFailed,
}: RoomHostProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const bridgePort = useRef<MessagePort | undefined>(undefined);
  const phaseRef = useRef<"lobby" | "playing">("lobby");
  const [gameUrl, setGameUrl] = useState<string>();
  const [gameName, setGameName] = useState("Game room");
  const [lobby, setLobby] = useState<RoomLobby>();
  const [selfId, setSelfId] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaveGameDialogOpen, setLeaveGameDialogOpen] = useState(false);
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [gameMenuClosing, setGameMenuClosing] = useState(false);
  const [playerMenuId, setPlayerMenuId] = useState<string>();
  const [playerMenuClosing, setPlayerMenuClosing] = useState(false);
  const [spectatorHintOpen, setSpectatorHintOpen] = useState(false);

  const phase = lobby?.phase ?? "lobby";
  phaseRef.current = phase;
  const isOwner = Boolean(selfId && lobby?.ownerId === selfId);
  const selfPlayer = lobby?.players.find((player) => player.id === selfId);
  const isSpectating = Boolean(selfId && lobby && !selfPlayer);
  const firstOpenSeat = lobby
    ? Array.from(
        { length: lobby.maxPlayers },
        (_, index) => index + 1,
      ).find((seat) => !lobby.players.some((player) => player.seat === seat))
    : undefined;
  const canStart = Boolean(
    lobby &&
    lobby.players.length >= lobby.minPlayers &&
    lobby.players.every(
      (player) => player.id === lobby.ownerId || player.ready,
    ),
  );

  useEffect(() => {
    document.title = `${gameName} | Playweft`;
    return () => {
      document.title = "Playweft";
    };
  }, [gameName]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        onEntryStatus("Loading game");
        setError(undefined);
        await createGuestSession();
        const launch = await getRoomLaunch(roomId);
        if (cancelled) return;
        setGameUrl(launch.gameUrl);
      } catch (reason) {
        if (!cancelled) {
          setError(message(reason));
          onEntryFailed();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onEntryFailed, onEntryStatus, roomId]);

  useEffect(() => {
    if (!gameUrl) return;
    let socket: WebSocket | undefined;
    let closed = false;
    let roomInitializing = false;
    let joined = false;
    let metadataReady = false;
    let membershipReady = false;
    let entryComplete = false;
    let lastPublishedVersion = -1;
    const gameOrigin = new URL(gameUrl).origin;
    const finishEntryIfReady = () => {
      if (entryComplete || !metadataReady || !membershipReady) return;
      entryComplete = true;
      onEntryReady();
    };
    const metadataFallback = window.setTimeout(() => {
      metadataReady = true;
      finishEntryIfReady();
    }, 5_000);

    const publish = (snapshot: RoomSnapshot) => {
      if (snapshot.version <= lastPublishedVersion) return;
      lastPublishedVersion = snapshot.version;
      bridgePort.current?.postMessage({
        type: "state",
        phase: "playing",
        state: snapshot.state,
        events: snapshot.events ?? [],
        version: snapshot.version,
      });
    };

    const reportBridgeError = (code: string, error: string) => {
      bridgePort.current?.postMessage({ type: "error", code, error });
    };

    const connect = () => {
      socket?.close();
      socket = connectRoom(roomId);
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data as string) as
          | RoomSnapshot
          | RoomLobby
          | { type: "error"; error: string };
        if (payload.type === "error") {
          setError(payload.error);
          reportBridgeError("ROOM_ERROR", payload.error);
        } else if (payload.type === "lobby") {
          setLobby(payload);
        } else {
          publish(payload);
          setLobby((current) =>
            current ? { ...current, phase: "playing" } : current,
          );
        }
      };
      socket.onerror = () => {
        setError("Live connection to the platform failed");
        if (!entryComplete) onEntryFailed();
        reportBridgeError(
          "REALTIME_CONNECTION_FAILED",
          "Live connection to the platform failed",
        );
      };
    };

    const onWindowMessage = (event: MessageEvent) => {
      if (
        event.origin !== gameOrigin ||
        event.source !== iframe.current?.contentWindow
      )
        return;
      if (
        event.data?.type !== "playweft:bridge-ready" ||
        event.data?.version !== 1
      )
        return;

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
          metadataReady = true;
          window.clearTimeout(metadataFallback);
          finishEntryIfReady();
          return;
        }
        if (data?.type === "initialize") {
          if (roomInitializing || joined) return;
          roomInitializing = true;
          try {
            onEntryStatus("Joining room");
            setError(undefined);
            await initializeRoom(roomId, initialization(data.initialization));
            const membership = await joinRoom(roomId);
            if (closed) return;
            applyMembership(membership, setLobby, setSelfId);
            joined = true;
            membershipReady = true;
            channel.port1.postMessage({
              type: "ready",
              phase: membership.phase,
              playerId: membership.selfId,
            });
            connect();
            finishEntryIfReady();
          } catch (reason) {
            setError(message(reason));
            onEntryFailed();
            channel.port1.postMessage({
              type: "error",
              code: "INITIALIZATION_REJECTED",
              error: message(reason),
            });
          }
          return;
        }
        if (data?.type !== "action") return;
        if (!joined || phaseRef.current === "lobby") {
          channel.port1.postMessage({
            type: "error",
            code: "GAME_NOT_STARTED",
            error: "The game has not started",
          });
          return;
        }
        try {
          publish(await sendAction(roomId, data.action));
        } catch (reason) {
          channel.port1.postMessage({
            type: "error",
            code: "ACTION_REJECTED",
            error: message(reason),
          });
        }
      };
      channel.port1.start();
      iframe.current?.contentWindow?.postMessage(
        { type: "playweft:bridge", version: 1 },
        gameOrigin,
        [channel.port2],
      );
    };

    window.addEventListener("message", onWindowMessage);
    return () => {
      closed = true;
      socket?.close();
      bridgePort.current?.close();
      bridgePort.current = undefined;
      window.clearTimeout(metadataFallback);
      window.removeEventListener("message", onWindowMessage);
    };
  }, [
    gameUrl,
    onEntryFailed,
    onEntryReady,
    onEntryStatus,
    onGameDiscovered,
    roomId,
  ]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setError(
        "Could not copy automatically. Copy the invite link from the address bar.",
      );
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      setError(undefined);
      const snapshot = await startRoom(roomId);
      bridgePort.current?.postMessage({ type: "state", state: snapshot.state });
      setLobby((current) =>
        current ? { ...current, phase: "playing" } : current,
      );
    } catch (reason) {
      setError(message(reason));
    } finally {
      setStarting(false);
    }
  };

  const kick = async (playerId: string) => {
    try {
      const nextLobby = await kickPlayer(roomId, playerId);
      setLobby(nextLobby);
    } catch (reason) {
      setError(message(reason));
    }
  };

  const chooseSeat = async (seat: number | null) => {
    try {
      setError(undefined);
      setLobby(await setRoomSeat(roomId, seat));
    } catch (reason) {
      setError(message(reason));
    }
  };

  const setReady = async () => {
    if (!selfPlayer) return;
    try {
      setError(undefined);
      setLobby(await setPlayerReady(roomId, !selfPlayer.ready));
    } catch (reason) {
      setError(message(reason));
    }
  };

  const joinFirstOpenSeat = async () => {
    if (firstOpenSeat === undefined) return;
    await chooseSeat(firstOpenSeat);
  };

  const requestBack = () => {
    if (selfId) setLeaveDialogOpen(true);
    else onBack();
  };

  const leaveGame = async () => {
    try {
      setError(undefined);
      await leaveRoom(roomId);
      onBack();
    } catch (reason) {
      setError(message(reason));
    }
  };

  const closeGameMenu = (after?: () => void) => {
    if (gameMenuClosing) return;
    setGameMenuClosing(true);
    window.setTimeout(() => {
      setGameMenuOpen(false);
      setGameMenuClosing(false);
      after?.();
    }, 160);
  };

  const closePlayerMenu = (after?: () => void) => {
    if (!playerMenuId || playerMenuClosing) return;
    setPlayerMenuClosing(true);
    window.setTimeout(() => {
      setPlayerMenuId(undefined);
      setPlayerMenuClosing(false);
      after?.();
    }, 140);
  };

  const showSpectatorHint = () => {
    setSpectatorHintOpen(true);
    window.setTimeout(() => setSpectatorHintOpen(false), 2_500);
  };

  return (
    <div className={`room-shell ${phase === "playing" ? "room-playing" : ""}`}>
      {phase === "lobby" && (
        <header className="topbar room-topbar">
          <button
            className="brand room-brand"
            onClick={requestBack}
            aria-label="Back to Playweft home"
          >
            <span className="brand-mark">
              <i />
              <i />
              <i />
            </span>
            <span className="room-brand-name">playweft</span>
          </button>
          <span className="room-mobile-game-name" title={gameName}>
            {gameName}
          </span>
          <span className="room-mobile-topbar-spacer" aria-hidden="true" />
        </header>
      )}
      <main className="room-host">
        {phase === "lobby" && (
          <>
            <header className="room-hero">
              <h1>{gameName}</h1>
            </header>
            <section className="lobby-panel" aria-live="polite">
              <div className="lobby-heading">
                <div>
                  <h2>Players</h2>
                  <p>
                    {lobby
                      ? `${lobby.players.length} / ${lobby.maxPlayers}`
                      : "Connecting…"}
                  </p>
                </div>
                <span className="lobby-requirement">
                  {lobby ? `${lobby.minPlayers} to start` : ""}
                </span>
              </div>
              <ol className="player-grid">
                {Array.from({ length: lobby?.maxPlayers ?? 0 }, (_, index) => {
                  const seat = index + 1;
                  const player = lobby?.players.find(
                    (candidate) => candidate.seat === seat,
                  );
                  if (!player)
                    return (
                      <li
                        key={`seat-${seat}`}
                        className="player-card player-card-empty"
                      >
                        <button
                          className="player-avatar player-avatar-seat"
                          type="button"
                          onClick={() => void chooseSeat(seat)}
                          aria-label={
                            isSpectating
                              ? `Join seat ${seat}`
                              : `Move to seat ${seat}`
                          }
                        >
                          <Armchair aria-hidden="true" />
                        </button>
                        <span className="player-card-copy">
                          <strong className="player-name">Sit here</strong>
                        </span>
                      </li>
                    );
                  const isSelf = player.id === selfId;
                  const isHost = player.id === lobby?.ownerId;
                  return (
                    <li
                      key={player.id}
                      className={`player-card ${playerMenuId === player.id ? "player-card-menu-open" : ""}`}
                    >
                      <span
                        className={`player-avatar avatar-${(seat - 1) % 4} ${isSelf ? "player-avatar-self" : ""}`}
                        title={isSelf ? "You" : undefined}
                      >
                        P{seat}
                        {!isHost && (
                          <span
                            className={`player-ready-marker ${player.ready ? "player-ready-marker-ready" : "player-ready-marker-pending"}`}
                            title={player.ready ? "Ready" : "Not ready"}
                            aria-label={player.ready ? "Ready" : "Not ready"}
                          >
                            {player.ready && <Check aria-hidden="true" />}
                          </span>
                        )}
                      </span>
                      <span className="player-card-copy">
                        <strong className="player-name" title={player.name}>
                          {player.name || `Player ${seat}`}
                          {isHost && (
                            <span
                              className="host-crown"
                              title="Host"
                              aria-label="Host"
                            >
                              <Crown aria-hidden="true" />
                            </span>
                          )}
                        </strong>
                      </span>
                      {isOwner && !isSelf && (
                        <>
                          {playerMenuId === player.id && (
                            <button
                              className={`player-menu-backdrop ${playerMenuClosing ? "player-menu-backdrop-closing" : ""}`}
                              type="button"
                              aria-label="Close player menu"
                              onClick={() => closePlayerMenu()}
                            />
                          )}
                          <button
                            className="player-menu-toggle"
                            type="button"
                            aria-label={`Player options for ${player.name || `Player ${seat}`}`}
                            aria-expanded={playerMenuId === player.id}
                            onClick={() => {
                              if (playerMenuId === player.id) closePlayerMenu();
                              else {
                                setPlayerMenuClosing(false);
                                setPlayerMenuId(player.id);
                              }
                            }}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </button>
                          {playerMenuId === player.id && (
                            <div
                              className={`player-menu ${playerMenuClosing ? "player-menu-closing" : ""}`}
                              role="menu"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => closePlayerMenu(() => void kick(player.id))}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
                {lobby && lobby.players.length < lobby.maxPlayers && (
                  <li className="player-card player-card-empty">
                    <button
                      className="player-avatar player-avatar-invite"
                      type="button"
                      onClick={() => setInviteDialogOpen(true)}
                      aria-label="Invite a player"
                    >
                      <Plus aria-hidden="true" />
                    </button>
                    <span className="player-card-copy">
                      <strong className="player-name">Invite</strong>
                    </span>
                  </li>
                )}
              </ol>
              <div className="spectator-controls">
                <p className="spectator-count">
                  {lobby?.spectators.length ?? 0} spectator
                  {lobby?.spectators.length === 1 ? "" : "s"}
                </p>
                {!isOwner && selfId && (
                  <span className="spectator-button-wrap">
                    <button
                      className="spectator-button"
                      type="button"
                      onClick={() =>
                        isSpectating
                          ? showSpectatorHint()
                          : void chooseSeat(null)
                      }
                      aria-describedby={
                        spectatorHintOpen ? "spectator-hint" : undefined
                      }
                    >
                      {isSpectating ? "Spectating" : "Spectate"}
                    </button>
                    {spectatorHintOpen && (
                      <span
                        className="spectator-tooltip"
                        id="spectator-hint"
                        role="tooltip"
                      >
                        Choose an empty seat to play.
                      </span>
                    )}
                  </span>
                )}
              </div>
            </section>
            <div className="room-actions">
              {isOwner && (
                <button
                  className="primary start-game"
                  disabled={starting || !canStart}
                  onClick={() => void start()}
                >
                  {starting ? "Starting…" : "Start game"}
                </button>
              )}
              {!isOwner && selfPlayer && (
                <button
                  className={
                    selfPlayer.ready ? "cancel-ready" : "primary start-game"
                  }
                  onClick={() => void setReady()}
                >
                  {selfPlayer.ready ? "Cancel ready" : "Ready"}
                </button>
              )}
              {!isOwner && isSpectating && (
                <button
                  className="primary start-game"
                  disabled={firstOpenSeat === undefined}
                  onClick={() => void joinFirstOpenSeat()}
                >
                  Join
                </button>
              )}
              <button onClick={() => void copyInvite()}>
                {copied ? "Invite link copied" : "Copy invite link"}
              </button>
            </div>
          </>
        )}
        {gameUrl && (
          <iframe
            className="game-frame"
            ref={iframe}
            title={gameName}
            src={gameUrl}
            sandbox="allow-scripts allow-same-origin"
          />
        )}
      </main>
      {error && (
        <ErrorToast message={error} onDismiss={() => setError(undefined)} />
      )}
      {inviteDialogOpen && (
        <InviteDialog
          url={window.location.href}
          onClose={() => setInviteDialogOpen(false)}
        />
      )}
      {leaveDialogOpen && (
        <Dialog
          title="Leave room?"
          onDismiss={() => setLeaveDialogOpen(false)}
          actions={[
            { label: "Cancel" },
            { label: "Leave", variant: "danger", onSelect: onBack },
          ]}
        >
          <p className="leave-dialog-copy">
            You will need the room link to return.
          </p>
        </Dialog>
      )}
      {leaveGameDialogOpen && (
        <Dialog
          title="Leave game?"
          onDismiss={() => setLeaveGameDialogOpen(false)}
          actions={[
            { label: "Cancel" },
            {
              label: "Leave",
              variant: "danger",
              onSelect: () => void leaveGame(),
            },
          ]}
        >
          <p className="leave-dialog-copy">
            The game will be notified that you left.
          </p>
        </Dialog>
      )}
      {phase === "playing" && (
        <>
          {gameMenuOpen && (
            <>
              <button
                className={`game-menu-backdrop ${gameMenuClosing ? "game-menu-backdrop-closing" : ""}`}
                type="button"
                aria-label="Close game menu"
                onClick={() => closeGameMenu()}
              />
              <div
                className={`game-menu ${gameMenuClosing ? "game-menu-closing" : ""}`}
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() =>
                    closeGameMenu(() => setLeaveGameDialogOpen(true))
                  }
                >
                  Leave game
                </button>
              </div>
            </>
          )}
          <button
            className="game-options"
            type="button"
            aria-label="Game options"
            aria-expanded={gameMenuOpen}
            onClick={() =>
              gameMenuOpen ? closeGameMenu() : setGameMenuOpen(true)
            }
          >
            <i />
            <i />
            <i />
          </button>
        </>
      )}
    </div>
  );
}

function applyMembership(
  membership: RoomJoin,
  setLobby: (lobby: RoomLobby) => void,
  setSelfId: (id: string) => void,
): void {
  const { selfId, ...lobby } = membership;
  setSelfId(selfId);
  setLobby(lobby);
}

function initialization(value: unknown): RoomInitialization {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid game initialization message");
  }
  const input = value as Record<string, unknown>;
  if (
    input.runtime !== "lua" ||
    typeof input.script !== "string" ||
    !isLimit(input.minPlayers) ||
    !isLimit(input.maxPlayers) ||
    input.minPlayers > input.maxPlayers
  ) {
    throw new Error(
      "The game must provide a Lua script and valid minPlayers / maxPlayers",
    );
  }
  return {
    runtime: "lua",
    script: input.script,
    minPlayers: input.minPlayers,
    maxPlayers: input.maxPlayers,
  };
}

function isLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 32
  );
}

function descriptor(
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

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unexpected error";
}

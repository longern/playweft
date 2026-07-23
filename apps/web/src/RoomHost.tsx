import { useEffect, useRef, useState } from "react";
import { Armchair, Check, Crown, MoreHorizontal, Plus } from "lucide-react";
import {
  connectRoom,
  changeRoomGame,
  createGuestSession,
  dissolveRoom,
  getRoomLaunch,
  initializeRoom,
  joinRoom,
  kickPlayer,
  setPlayerReady,
  setRoomSeat,
  sendAction,
  startRoom,
  transferRoomHost,
  returnRoomToLobby,
  type RoomInitialization,
  type RoomJoin,
  type RoomLobby,
  type RoomSnapshot,
} from "./platform-api";
import ErrorToast from "./ErrorToast";
import Dialog from "./Dialog";
import GameInfoPanel, { type GameInfoAction } from "./GameInfoPanel";
import InviteDialog from "./InviteDialog";
import Menu from "./Menu";
import ChangeGameDialog from "./ChangeGameDialog";

const MAX_RECONNECT_ATTEMPTS = 5;
const ROOM_HANDSHAKE_TIMEOUT_MS = 10_000;

export interface RecentGame {
  url: string;
  name: string;
  icon?: string;
  helpUrl?: string;
  modes?: GameMode[];
  liveRoom?: boolean;
}

export type GameMode = "solo" | "room";

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
  const [gameRevision, setGameRevision] = useState(0);
  const [gameName, setGameName] = useState("Game room");
  const [gameIconHref, setGameIconHref] = useState<string>();
  const [lobby, setLobby] = useState<RoomLobby>();
  const [selfId, setSelfId] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [gameInfoOpen, setGameInfoOpen] = useState(false);
  const [playerMenuId, setPlayerMenuId] = useState<string>();
  const [playerMenuClosing, setPlayerMenuClosing] = useState(false);
  const [spectatorHintOpen, setSpectatorHintOpen] = useState(false);
  const [lobbyMenuOpen, setLobbyMenuOpen] = useState(false);
  const [lobbyMenuAnchor, setLobbyMenuAnchor] = useState<HTMLButtonElement>();
  const [gameHelpHref, setGameHelpHref] = useState<string>();
  const [gameHelpOpen, setGameHelpOpen] = useState(false);
  const [changeGameOpen, setChangeGameOpen] = useState(false);
  const [dissolveDialogOpen, setDissolveDialogOpen] = useState(false);

  const phase = lobby?.phase ?? "lobby";
  phaseRef.current = phase;
  const isOwner = Boolean(selfId && lobby?.ownerId === selfId);
  const selfPlayer = lobby?.players.find((player) => player.id === selfId);
  const isSpectating = Boolean(selfId && lobby && !selfPlayer);
  const firstOpenSeat = lobby
    ? Array.from({ length: lobby.maxPlayers }, (_, index) => index + 1).find(
        (seat) => !lobby.players.some((player) => player.seat === seat),
      )
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
    let heartbeatTimer: number | undefined;
    let reconnectTimer: number | undefined;
    let connectionErrorSuppressTimer: number | undefined;
    let reconnectAttempts = 0;
    let suppressConnectionError = false;
    let closed = false;
    let roomInitializing = false;
    let joined = false;
    let liveRoom = false;
    let bridgeConnected = false;
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

    const handshakeTimeout = window.setTimeout(() => {
      if (closed || joined) return;
      const error = bridgeConnected
        ? "This game did not send Playweft room initialization."
        : "This URL does not expose the Playweft game bridge.";
      setError(error);
      onEntryFailed();
      reportBridgeError("GAME_BRIDGE_TIMEOUT", error);
    }, ROOM_HANDSHAKE_TIMEOUT_MS);

    const suppressNextConnectionError = () => {
      suppressConnectionError = true;
      window.clearTimeout(connectionErrorSuppressTimer);
      connectionErrorSuppressTimer = window.setTimeout(() => {
        suppressConnectionError = false;
      }, 5_000);
    };

    const connect = () => {
      window.clearTimeout(reconnectTimer);
      window.clearInterval(heartbeatTimer);
      socket?.close();
      const nextSocket = connectRoom(roomId);
      let receivedServerSignal = false;
      socket = nextSocket;
      nextSocket.onopen = () => {
        const heartbeat = () => {
          if (nextSocket.readyState === WebSocket.OPEN)
            nextSocket.send(JSON.stringify({ type: "heartbeat" }));
        };
        heartbeat();
        heartbeatTimer = window.setInterval(heartbeat, 15_000);
      };
      nextSocket.onmessage = (event) => {
        const payload = JSON.parse(event.data as string) as
          | RoomSnapshot
          | RoomLobby
          | { type: "action-result"; requestId: string; version: number }
          | { type: "game_changed"; gameUrl: string }
          | { type: "room_dissolved"; error: string }
          | { type: "error"; error: string; requestId?: string };
        if (payload.type === "room_dissolved") {
          closed = true;
          socket?.close();
          onBack();
          return;
        }
        if (payload.type === "action-result") {
          bridgePort.current?.postMessage(payload);
          return;
        }
        if (payload.type === "error") {
          if (payload.requestId) {
            bridgePort.current?.postMessage({
              type: "error",
              code: "ACTION_REJECTED",
              error: payload.error,
              requestId: payload.requestId,
            });
            return;
          }
          setError(payload.error);
          reportBridgeError("ROOM_ERROR", payload.error);
          return;
        }
        receivedServerSignal = true;
        reconnectAttempts = 0;
        setError(undefined);
        if (payload.type === "game_changed") {
          setLobby(undefined);
          setGameHelpHref(undefined);
          setGameHelpOpen(false);
          setGameUrl(payload.gameUrl);
          setGameRevision((revision) => revision + 1);
        } else if (payload.type === "lobby") {
          setLobby(payload);
        } else {
          publish(payload);
          setLobby((current) =>
            current ? { ...current, phase: "playing" } : current,
          );
        }
      };
      nextSocket.onerror = () => {
        if (suppressConnectionError) {
          suppressConnectionError = false;
          window.clearTimeout(connectionErrorSuppressTimer);
          return;
        }
        setError("Live connection to the platform failed");
        if (!entryComplete) onEntryFailed();
        reportBridgeError(
          "REALTIME_CONNECTION_FAILED",
          "Live connection to the platform failed",
        );
      };
      nextSocket.onclose = (event) => {
        window.clearInterval(heartbeatTimer);
        if (closed || socket !== nextSocket) return;
        if (event.code === 4004) {
          closed = true;
          onBack();
          return;
        }
        if (receivedServerSignal) reconnectAttempts = 0;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          const error = "Live connection could not be restored";
          setError(error);
          reportBridgeError("REALTIME_CONNECTION_FAILED", error);
          return;
        }
        reconnectAttempts += 1;
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 2_000);
        }
      };
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !joined) return;
      suppressNextConnectionError();
      setError(undefined);
      reconnectAttempts = 0;
      connect();
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
      bridgeConnected = true;
      const channel = new MessageChannel();
      bridgePort.current = channel.port1;
      channel.port1.onmessage = async (bridgeEvent) => {
        const data = bridgeEvent.data;
        if (data?.type === "descriptor") {
          const game = descriptor(data.descriptor, gameOrigin, gameUrl);
          if (!game) return;
          setGameName(game.name);
          setGameIconHref(game.icon);
          setGameHelpHref(game.helpUrl);
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
            const roomInitialization = initialization(data.initialization);
            liveRoom = roomInitialization.liveRoom === true;
            await initializeRoom(roomId, roomInitialization);
            const membership = await joinRoom(roomId);
            if (closed) return;
            applyMembership(membership, setLobby, setSelfId);
            joined = true;
            window.clearTimeout(handshakeTimeout);
            membershipReady = true;
            channel.port1.postMessage({
              type: "ready",
              phase: membership.phase,
              playerId: membership.selfId,
            });
            connect();
            finishEntryIfReady();
          } catch (reason) {
            window.clearTimeout(handshakeTimeout);
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
        const requestId = bridgeRequestId(data.requestId);
        if (!requestId) {
          channel.port1.postMessage({
            type: "error",
            code: "INVALID_ACTION_REQUEST",
            error: "An action requestId is required",
          });
          return;
        }
        if (!joined || phaseRef.current === "lobby") {
          channel.port1.postMessage({
            type: "error",
            code: "GAME_NOT_STARTED",
            error: "The game has not started",
            requestId,
          });
          return;
        }
        try {
          if (liveRoom) {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
              throw new Error("Live connection is not ready");
            }
            socket.send(
              JSON.stringify({
                type: "action",
                requestId,
                action: data.action,
              }),
            );
            return;
          }
          const snapshot = await sendAction(roomId, data.action);
          publish(snapshot);
          channel.port1.postMessage({
            type: "action-result",
            requestId,
            version: snapshot.version,
          });
        } catch (reason) {
          channel.port1.postMessage({
            type: "error",
            code: "ACTION_REJECTED",
            error: message(reason),
            requestId,
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
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(connectionErrorSuppressTimer);
      window.clearTimeout(handshakeTimeout);
      window.clearInterval(heartbeatTimer);
      socket?.close();
      bridgePort.current?.close();
      bridgePort.current = undefined;
      window.clearTimeout(metadataFallback);
      window.removeEventListener("message", onWindowMessage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    gameRevision,
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

  const transferHost = async (playerId: string) => {
    try {
      setError(undefined);
      setLobby(await transferRoomHost(roomId, playerId));
    } catch (reason) {
      setError(message(reason));
    }
  };

  const returnToRoom = async () => {
    try {
      setError(undefined);
      setLobby(await returnRoomToLobby(roomId));
      setGameInfoOpen(false);
    } catch (reason) {
      setError(message(reason));
    }
  };

  const changeGame = async (url: string) => {
    try {
      setError(undefined);
      setChangeGameOpen(false);
      await changeRoomGame(roomId, url);
    } catch (reason) {
      setError(message(reason));
    }
  };

  const dissolve = async () => {
    try {
      setError(undefined);
      await dissolveRoom(roomId);
      onBack();
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

  const gameInfoActions: GameInfoAction[] = isOwner
    ? [
        {
          label: "Return to room",
          variant: "primary",
          onSelect: () => void returnToRoom(),
        },
      ]
    : [];

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
          <button
            className="lobby-options lobby-options-mobile"
            type="button"
            aria-label="Room options"
            aria-expanded={lobbyMenuOpen}
            onClick={(event) => {
              setLobbyMenuAnchor(event.currentTarget);
              setLobbyMenuOpen(true);
            }}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
        </header>
      )}
      <main className="room-host">
        {phase === "lobby" && (
          <>
            <header className="room-hero">
              <div className="room-hero-heading">
                <h1>{gameName}</h1>
                <button
                  className="lobby-options lobby-options-desktop"
                  type="button"
                  aria-label="Room options"
                  aria-expanded={lobbyMenuOpen}
                  onClick={(event) => {
                    setLobbyMenuAnchor(event.currentTarget);
                    setLobbyMenuOpen(true);
                  }}
                >
                  <MoreHorizontal aria-hidden="true" />
                </button>
              </div>
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
                                onClick={() =>
                                  closePlayerMenu(
                                    () => void transferHost(player.id),
                                  )
                                }
                              >
                                Make host
                              </button>
                              <button
                                className="player-menu-remove"
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  closePlayerMenu(() => void kick(player.id))
                                }
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
            key={gameRevision}
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
      {dissolveDialogOpen && (
        <Dialog
          title="Dissolve room?"
          onDismiss={() => setDissolveDialogOpen(false)}
          actions={[
            { label: "Cancel" },
            {
              label: "Dissolve room",
              variant: "danger",
              onSelect: () => void dissolve(),
            },
          ]}
        >
          <p className="leave-dialog-copy">
            This closes the room for everyone and the invite link will stop
            working.
          </p>
        </Dialog>
      )}
      {gameHelpOpen && gameHelpHref && (
        <Dialog
          title="Game help"
          size="large"
          onDismiss={() => setGameHelpOpen(false)}
        >
          <iframe
            className="game-help-frame"
            title={`${gameName} help`}
            src={gameHelpHref}
          />
        </Dialog>
      )}
      {changeGameOpen && (
        <ChangeGameDialog
          onClose={() => setChangeGameOpen(false)}
          onSubmit={(url) => void changeGame(url)}
        />
      )}
      {phase === "lobby" && lobbyMenuOpen && lobbyMenuAnchor && (
        <Menu
          ariaLabel="Room options"
          anchor={lobbyMenuAnchor}
          className="lobby-menu"
          onClose={() => setLobbyMenuOpen(false)}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setLobbyMenuOpen(false);
              setGameInfoOpen(true);
            }}
          >
            Game info
          </button>
          {gameHelpHref && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setLobbyMenuOpen(false);
                setGameHelpOpen(true);
              }}
            >
              Game help
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setLobbyMenuOpen(false);
                setChangeGameOpen(true);
              }}
            >
              Change game
            </button>
          )}
          {isOwner && (
            <button
              className="menu-danger"
              type="button"
              role="menuitem"
              onClick={() => {
                setLobbyMenuOpen(false);
                setDissolveDialogOpen(true);
              }}
            >
              Dissolve room
            </button>
          )}
        </Menu>
      )}
      {gameInfoOpen && gameUrl && (
        <GameInfoPanel
          actions={phase === "playing" ? gameInfoActions : undefined}
          icon={gameIconHref}
          name={gameName}
          url={gameUrl}
          onClose={() => setGameInfoOpen(false)}
        />
      )}
      {phase === "playing" && (
        <>
          <button
            className="game-options"
            type="button"
            aria-label="Game information"
            aria-expanded={gameInfoOpen}
            onClick={() => setGameInfoOpen(true)}
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
    liveRoom: input.liveRoom === true,
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

function bridgeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    ? value
    : undefined;
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
  let helpUrl: string | undefined;
  const modes = gameModes(input.modes);
  const liveRoom = input.liveRoom === true;
  if (typeof input.icon === "string") {
    try {
      const resolved = new URL(input.icon, gameUrl);
      if (resolved.origin === gameOrigin) icon = resolved.toString();
    } catch {
      // Icon metadata is optional.
    }
  }
  if (typeof input.helpUrl === "string") {
    try {
      const resolved = new URL(input.helpUrl, gameUrl);
      if (resolved.origin === gameOrigin) helpUrl = resolved.toString();
    } catch {
      // Help metadata is optional.
    }
  }
  return {
    url: gameUrl,
    name: input.name,
    icon,
    helpUrl,
    ...(modes ? { modes } : {}),
    ...(liveRoom ? { liveRoom } : {}),
  };
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unexpected error";
}

function gameModes(value: unknown): GameMode[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const modes = value.filter(
    (item): item is GameMode => item === "solo" || item === "room",
  );
  const uniqueModes = [...new Set(modes)];
  return uniqueModes.length > 0 ? uniqueModes : undefined;
}

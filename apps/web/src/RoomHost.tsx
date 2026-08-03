import { useEffect, useRef, useState } from "react";
import { Armchair, Check, Crown, MoreHorizontal, Plus } from "lucide-react";
import {
  JsonRpcErrorCode,
  isJson,
  type JsonValue,
} from "@playweft/game-protocol";
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
  type RoomActionResult,
  type RoomJoin,
  type RoomLobby,
  type RoomSnapshot,
} from "./platform-api";
import ErrorToast from "./ErrorToast";
import Dialog from "./Dialog";
import GameInfoPanel, { type GameInfoAction } from "./GameInfoPanel";
import GameHelpDialog from "./GameHelpDialog";
import InviteDialog from "./InviteDialog";
import Menu from "./Menu";
import ChangeGameDialog from "./ChangeGameDialog";
import { ClipboardPrompt, useClipboardRead } from "./ClipboardPrompt";
import { isFavoriteGame, toggleFavoriteGame } from "./favorite-games";
import {
  PLAYWEFT_BRIDGE_VERSION,
  RpcFault,
  dispatchRpcMessage,
  postRpcNotification,
  rpcPlatformFault,
} from "./json-rpc";
import {
  loadGameManifest,
  manifestUrlFromInput,
  manifestPermissionReason,
  type DiscoveredGame,
  type LoadedGame,
} from "./game-manifest";
import { localizeGameName, useI18n } from "./i18n";
import { useGameViewport } from "./use-game-viewport";

const MAX_RECONNECT_ATTEMPTS = 5;
const ROOM_HANDSHAKE_TIMEOUT_MS = 10_000;

interface RoomHostProps {
  roomId: string;
  onBack(): void;
  onGameDiscovered(game: DiscoveredGame): void;
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
  const { locale, t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const iframe = useRef<HTMLIFrameElement>(null);
  const bridgePort = useRef<MessagePort | undefined>(undefined);
  const phaseRef = useRef<"lobby" | "playing">("lobby");
  const [manifestUrl, setManifestUrl] = useState<string>();
  const [gameUrl, setGameUrl] = useState<string>();
  const [loadedGame, setLoadedGame] = useState<LoadedGame>();
  const [gameRevision, setGameRevision] = useState(0);
  const [game, setGame] = useState<DiscoveredGame>();
  const [gameIconHref, setGameIconHref] = useState<string>();
  const [lobby, setLobby] = useState<RoomLobby>();
  const [selfId, setSelfId] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [gameInfoOpen, setGameInfoOpen] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [playerMenuId, setPlayerMenuId] = useState<string>();
  const [playerMenuClosing, setPlayerMenuClosing] = useState(false);
  const [spectatorHintOpen, setSpectatorHintOpen] = useState(false);
  const [lobbyMenuOpen, setLobbyMenuOpen] = useState(false);
  const [lobbyMenuAnchor, setLobbyMenuAnchor] = useState<HTMLButtonElement>();
  const [gameHelpHref, setGameHelpHref] = useState<string>();
  const [gameHelpOpen, setGameHelpOpen] = useState(false);
  const [changeGameOpen, setChangeGameOpen] = useState(false);
  const [dissolveDialogOpen, setDissolveDialogOpen] = useState(false);
  const gameName = game ? localizeGameName(game, locale) : t("gameRoom");
  const gameOrigin = gameUrl ? new URL(gameUrl).origin : undefined;
  const clipboard = useClipboardRead(gameName, gameOrigin);

  useEffect(() => {
    if (game) setIsFavorite(isFavoriteGame(game));
  }, [game]);

  const phase = lobby?.phase ?? "lobby";
  phaseRef.current = phase;
  useGameViewport(phase === "playing");
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
        onEntryStatus(tRef.current("loadingGame"));
        setError(undefined);
        await createGuestSession();
        const launch = await getRoomLaunch(roomId);
        if (cancelled) return;
        setManifestUrl(launch.manifestUrl);
      } catch (reason) {
        if (!cancelled) {
          setError(message(reason, tRef.current("unexpectedError")));
          onEntryFailed();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onEntryFailed, onEntryStatus, roomId]);

  useEffect(() => {
    if (!manifestUrl) return;
    let cancelled = false;
    setGameUrl(undefined);
    setLoadedGame(undefined);
    void loadGameManifest(manifestUrl)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded.room) {
          throw new Error("The game Manifest does not declare room mode");
        }
        setGame(loaded.game);
        setGameIconHref(loaded.game.icon);
        setGameHelpHref(loaded.game.helpUrl);
        onGameDiscovered(loaded.game);
        setLoadedGame(loaded);
        setGameUrl(loaded.game.url);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(message(reason, tRef.current("unexpectedError")));
          onEntryFailed();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manifestUrl, onEntryFailed, onGameDiscovered]);

  useEffect(() => {
    if (!gameUrl || !loadedGame?.room) return;
    const roomConfiguration = loadedGame.room;
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
    let membershipReady = false;
    let entryComplete = false;
    let joinedPlayerId: string | undefined;
    const clipboardDeclared =
      loadedGame.game.permissions.includes("clipboard.readText");
    const clipboardReason = manifestPermissionReason(
      loadedGame.manifest,
      "clipboard.readText",
    );
    let lastPublishedMatchId: string | undefined;
    let lastPublishedVersion = -1;
    let latestSnapshot: RoomSnapshot | undefined;
    const liveActionRequests = new Map<
      string,
      {
        resolve(value: JsonValue): void;
        reject(reason: RpcFault): void;
      }
    >();
    const currentGameOrigin = new URL(gameUrl).origin;
    const finishEntryIfReady = () => {
      if (entryComplete || !membershipReady) return;
      entryComplete = true;
      onEntryReady();
    };
    const sendSnapshot = (snapshot: RoomSnapshot) => {
      postRpcNotification(bridgePort.current, "game.state", {
        phase: "playing",
        state: snapshot.state,
        events: snapshot.events ?? [],
        matchId: snapshot.matchId,
        version: snapshot.version,
        serverTime: snapshot.serverTime,
      });
    };

    const publish = (snapshot: RoomSnapshot) => {
      if (snapshot.matchId !== lastPublishedMatchId) {
        lastPublishedMatchId = snapshot.matchId;
        lastPublishedVersion = -1;
      }
      if (snapshot.version <= lastPublishedVersion) return;
      lastPublishedVersion = snapshot.version;
      latestSnapshot = snapshot;
      sendSnapshot(snapshot);
    };

    const reportBridgeError = (code: string, error: string) => {
      postRpcNotification(bridgePort.current, "platform.error", {
        error: { code, message: error, retryable: false },
      });
    };

    const rejectLiveActions = (code: string, error: string) => {
      for (const pending of liveActionRequests.values()) {
        pending.reject(rpcPlatformFault(code, error, true));
      }
      liveActionRequests.clear();
    };

    const handshakeTimeout = window.setTimeout(() => {
      if (closed || joined) return;
      const error = bridgeConnected
        ? tRef.current("gameInitializationMissing")
        : tRef.current("gameBridgeUnavailable");
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
      rejectLiveActions(
        "REALTIME_CONNECTION_INTERRUPTED",
        tRef.current("liveConnectionNotReady"),
      );
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
          | RoomActionResult
          | { type: "game_changed"; manifestUrl: string }
          | { type: "room_dissolved"; error: string }
          | { type: "error"; error: string; requestId?: string };
        if (payload.type === "room_dissolved") {
          closed = true;
          socket?.close();
          onBack();
          return;
        }
        if (payload.type === "action-result") {
          const pending = liveActionRequests.get(payload.requestId);
          if (pending) {
            liveActionRequests.delete(payload.requestId);
            pending.resolve(actionResultForRpc(payload));
          }
          return;
        }
        if (payload.type === "error") {
          if (payload.requestId) {
            const pending = liveActionRequests.get(payload.requestId);
            if (pending) {
              liveActionRequests.delete(payload.requestId);
              pending.reject(
                rpcPlatformFault("ACTION_REJECTED", payload.error),
              );
            }
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
          setGame(undefined);
          setGameHelpHref(undefined);
          setGameHelpOpen(false);
          setManifestUrl(payload.manifestUrl);
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
        setError(tRef.current("liveConnectionFailed"));
        if (!entryComplete) onEntryFailed();
        reportBridgeError(
          "REALTIME_CONNECTION_FAILED",
          tRef.current("liveConnectionFailed"),
        );
      };
      nextSocket.onclose = (event) => {
        window.clearInterval(heartbeatTimer);
        if (closed || socket !== nextSocket) return;
        rejectLiveActions(
          "REALTIME_CONNECTION_INTERRUPTED",
          tRef.current("liveConnectionNotReady"),
        );
        if (event.code === 4004) {
          closed = true;
          onBack();
          return;
        }
        if (receivedServerSignal) reconnectAttempts = 0;
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          const error = tRef.current("liveConnectionNotRestored");
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
        event.data?.version !== PLAYWEFT_BRIDGE_VERSION
      )
        return;

      clipboard.cancelPending();
      rejectLiveActions("BRIDGE_REPLACED", "The game bridge was replaced");
      bridgePort.current?.close();
      bridgeConnected = true;
      const channel = new MessageChannel();
      bridgePort.current = channel.port1;
      channel.port1.onmessage = (bridgeEvent) => {
        void dispatchRpcMessage(channel.port1, bridgeEvent.data, {
          "game.initialize": {
            async handle() {
              if (joined && joinedPlayerId) {
                if (latestSnapshot) {
                  window.setTimeout(() => {
                    if (!closed && latestSnapshot) sendSnapshot(latestSnapshot);
                  }, 0);
                }
                return {
                  mode: "room",
                  protocolVersion: PLAYWEFT_BRIDGE_VERSION,
                  capabilities: loadedGame.game.permissions,
                  phase: phaseRef.current,
                  playerId: joinedPlayerId,
                };
              }
              if (roomInitializing) {
                throw rpcPlatformFault(
                  "INITIALIZATION_IN_PROGRESS",
                  "Room initialization is already in progress",
                  true,
                );
              }
              roomInitializing = true;
              try {
                onEntryStatus(tRef.current("joiningRoom"));
                setError(undefined);
                const roomInitialization = roomConfiguration;
                liveRoom = roomInitialization.liveRoom === true;
                await initializeRoom(roomId, roomInitialization);
                const membership = await joinRoom(roomId);
                if (closed) {
                  throw rpcPlatformFault(
                    "BRIDGE_CLOSED",
                    "The game bridge was closed",
                    true,
                  );
                }
                applyMembership(membership, setLobby, setSelfId);
                joined = true;
                joinedPlayerId = membership.selfId;
                window.clearTimeout(handshakeTimeout);
                membershipReady = true;
                connect();
                finishEntryIfReady();
                return {
                  mode: "room",
                  protocolVersion: PLAYWEFT_BRIDGE_VERSION,
                  capabilities: loadedGame.game.permissions,
                  phase: membership.phase,
                  playerId: membership.selfId,
                };
              } catch (reason) {
                window.clearTimeout(handshakeTimeout);
                const error = message(reason, tRef.current("unexpectedError"));
                setError(error);
                onEntryFailed();
                if (reason instanceof RpcFault) throw reason;
                throw rpcPlatformFault("INITIALIZATION_REJECTED", error);
              } finally {
                roomInitializing = false;
              }
            },
          },
          "room.action": {
            async handle(params, requestId) {
              if (!requestId) {
                throw new RpcFault(
                  JsonRpcErrorCode.InvalidRequest,
                  "room.action requires a JSON-RPC id",
                );
              }
              const action = actionFromRpcParams(params);
              if (!joined || phaseRef.current === "lobby") {
                throw rpcPlatformFault(
                  "GAME_NOT_STARTED",
                  tRef.current("gameNotStarted"),
                );
              }
              if (liveRoom) {
                if (!socket || socket.readyState !== WebSocket.OPEN) {
                  throw rpcPlatformFault(
                    "REALTIME_CONNECTION_NOT_READY",
                    tRef.current("liveConnectionNotReady"),
                    true,
                  );
                }
                if (liveActionRequests.has(requestId)) {
                  throw rpcPlatformFault(
                    "DUPLICATE_REQUEST",
                    "A request with this JSON-RPC id is already pending",
                  );
                }
                const result = new Promise<JsonValue>((resolve, reject) => {
                  liveActionRequests.set(requestId, { resolve, reject });
                });
                socket.send(
                  JSON.stringify({
                    type: "action",
                    requestId,
                    action,
                  }),
                );
                return result;
              }
              try {
                const response = await sendAction(roomId, requestId, action);
                if (response.update) publish(response.update);
                return actionResultForRpc(response.result);
              } catch (reason) {
                throw rpcPlatformFault(
                  "ACTION_REJECTED",
                  message(reason, tRef.current("unexpectedError")),
                );
              }
            },
          },
          "clipboard.readText": {
            async handle() {
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
        currentGameOrigin,
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
      rejectLiveActions("BRIDGE_CLOSED", "The game bridge was closed");
      clipboard.cancelPending();
      bridgePort.current?.close();
      bridgePort.current = undefined;
      window.removeEventListener("message", onWindowMessage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    gameRevision,
    gameUrl,
    loadedGame,
    onEntryFailed,
    onEntryReady,
    onEntryStatus,
    onGameDiscovered,
    roomId,
    clipboard.cancelPending,
    clipboard.requestReadText,
  ]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setError(t("inviteCopyFailed"));
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      setError(undefined);
      const snapshot = await startRoom(roomId);
      postRpcNotification(bridgePort.current, "game.state", {
        phase: "playing",
        state: snapshot.state,
        events: snapshot.events ?? [],
        matchId: snapshot.matchId,
        version: snapshot.version,
        serverTime: snapshot.serverTime,
      });
      setLobby((current) =>
        current ? { ...current, phase: "playing" } : current,
      );
    } catch (reason) {
      setError(message(reason, t("unexpectedError")));
    } finally {
      setStarting(false);
    }
  };

  const kick = async (playerId: string) => {
    try {
      const nextLobby = await kickPlayer(roomId, playerId);
      setLobby(nextLobby);
    } catch (reason) {
      setError(message(reason, t("unexpectedError")));
    }
  };

  const transferHost = async (playerId: string) => {
    try {
      setError(undefined);
      setLobby(await transferRoomHost(roomId, playerId));
    } catch (reason) {
      setError(message(reason, t("unexpectedError")));
    }
  };

  const returnToRoom = async () => {
    try {
      setError(undefined);
      setLobby(await returnRoomToLobby(roomId));
      setGameInfoOpen(false);
    } catch (reason) {
      setError(message(reason, t("unexpectedError")));
    }
  };

  const changeGame = async (url: string) => {
    try {
      setError(undefined);
      setChangeGameOpen(false);
      const next = await loadGameManifest(manifestUrlFromInput(url));
      if (!next.manifest.modes.room) {
        throw new Error("The game Manifest does not declare room mode");
      }
      await changeRoomGame(roomId, next.game.manifestUrl);
    } catch (reason) {
      setError(message(reason, t("unexpectedError")));
    }
  };

  const dissolve = async () => {
    try {
      setError(undefined);
      await dissolveRoom(roomId);
      onBack();
    } catch (reason) {
      setError(message(reason, t("unexpectedError")));
    }
  };

  const chooseSeat = async (seat: number | null) => {
    try {
      setError(undefined);
      setLobby(await setRoomSeat(roomId, seat));
    } catch (reason) {
      setError(message(reason, t("unexpectedError")));
    }
  };

  const setReady = async () => {
    if (!selfPlayer) return;
    try {
      setError(undefined);
      setLobby(await setPlayerReady(roomId, !selfPlayer.ready));
    } catch (reason) {
      setError(message(reason, t("unexpectedError")));
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
          label: t("returnToRoom"),
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
            aria-label={t("backToPlayweftHome")}
          >
            <img className="brand-mark" src="/favicon.svg" alt="" />
            <span className="room-brand-name">playweft</span>
          </button>
          <span className="room-mobile-game-name" title={gameName}>
            {gameName}
          </span>
          <button
            className="lobby-options lobby-options-mobile"
            type="button"
            aria-label={t("roomOptions")}
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
            <p className="room-mobile-id">{t("roomNumber", { roomId })}</p>
            <header className="room-hero">
              <div className="room-hero-heading">
                <h1>{gameName}</h1>
                <button
                  className="lobby-options lobby-options-desktop"
                  type="button"
                  aria-label={t("roomOptions")}
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
                  <h2>{t("players")}</h2>
                  <p>
                    {lobby
                      ? `${lobby.players.length} / ${lobby.maxPlayers}`
                      : t("connecting")}
                  </p>
                </div>
                <span className="lobby-requirement">
                  {lobby
                    ? t("playersToStart", { count: lobby.minPlayers })
                    : ""}
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
                              ? t("joinSeat", { seat })
                              : t("moveToSeat", { seat })
                          }
                        >
                          <Armchair aria-hidden="true" />
                        </button>
                        <span className="player-card-copy">
                          <strong className="player-name">
                            {t("sitHere")}
                          </strong>
                        </span>
                      </li>
                    );
                  const isSelf = player.id === selfId;
                  const isHost = player.id === lobby?.ownerId;
                  const playerName = player.name || t("player", { seat });
                  return (
                    <li
                      key={player.id}
                      className={`player-card ${playerMenuId === player.id ? "player-card-menu-open" : ""}`}
                    >
                      <span
                        className={`player-avatar avatar-${(seat - 1) % 4} ${isSelf ? "player-avatar-self" : ""}`}
                        title={isSelf ? t("you") : undefined}
                      >
                        P{seat}
                        {!isHost && (
                          <span
                            className={`player-ready-marker ${player.ready ? "player-ready-marker-ready" : "player-ready-marker-pending"}`}
                            title={player.ready ? t("ready") : t("notReady")}
                            aria-label={
                              player.ready ? t("ready") : t("notReady")
                            }
                          >
                            {player.ready && <Check aria-hidden="true" />}
                          </span>
                        )}
                      </span>
                      <span className="player-card-copy">
                        <strong className="player-name" title={player.name}>
                          {playerName}
                          {isHost && (
                            <span
                              className="host-crown"
                              title={t("host")}
                              aria-label={t("host")}
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
                              aria-label={t("closePlayerMenu")}
                              onClick={() => closePlayerMenu()}
                            />
                          )}
                          <button
                            className="player-menu-toggle"
                            type="button"
                            aria-label={t("playerOptions", {
                              name: playerName,
                            })}
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
                                {t("makeHost")}
                              </button>
                              <button
                                className="player-menu-remove"
                                type="button"
                                role="menuitem"
                                onClick={() =>
                                  closePlayerMenu(() => void kick(player.id))
                                }
                              >
                                {t("remove")}
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
                      aria-label={t("invitePlayer")}
                    >
                      <Plus aria-hidden="true" />
                    </button>
                    <span className="player-card-copy">
                      <strong className="player-name">{t("invite")}</strong>
                    </span>
                  </li>
                )}
              </ol>
              <div className="spectator-controls">
                <p className="spectator-count">
                  {t("spectatorCount", {
                    count: lobby?.spectators.length ?? 0,
                    suffix:
                      locale === "en" && lobby?.spectators.length !== 1
                        ? "s"
                        : "",
                  })}
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
                      {isSpectating ? t("spectating") : t("spectate")}
                    </button>
                    {spectatorHintOpen && (
                      <span
                        className="spectator-tooltip"
                        id="spectator-hint"
                        role="tooltip"
                      >
                        {t("chooseEmptySeat")}
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
                  {starting ? t("starting") : t("startGame")}
                </button>
              )}
              {!isOwner && selfPlayer && (
                <button
                  className={
                    selfPlayer.ready ? "cancel-ready" : "primary start-game"
                  }
                  onClick={() => void setReady()}
                >
                  {selfPlayer.ready ? t("cancelReady") : t("ready")}
                </button>
              )}
              {!isOwner && isSpectating && (
                <button
                  className="primary start-game"
                  disabled={firstOpenSeat === undefined}
                  onClick={() => void joinFirstOpenSeat()}
                >
                  {t("joinRoom")}
                </button>
              )}
              <button onClick={() => void copyInvite()}>
                {copied ? t("inviteLinkCopied") : t("copyInviteLink")}
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
            sandbox="allow-scripts allow-same-origin allow-forms"
            allow="clipboard-read 'none'; clipboard-write 'none'"
          />
        )}
      </main>
      <ClipboardPrompt
        prompt={clipboard.prompt}
        notice={clipboard.notice}
        onAllow={() => void clipboard.allow()}
        onDeny={clipboard.deny}
        onDismissNotice={clipboard.clearNotice}
      />
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
          title={t("leaveRoom")}
          onDismiss={() => setLeaveDialogOpen(false)}
          actions={[
            { label: t("cancel") },
            { label: t("leave"), variant: "danger", onSelect: onBack },
          ]}
        >
          <p className="leave-dialog-copy">{t("needRoomLinkToReturn")}</p>
        </Dialog>
      )}
      {dissolveDialogOpen && (
        <Dialog
          title={t("dissolveRoom")}
          onDismiss={() => setDissolveDialogOpen(false)}
          actions={[
            { label: t("cancel") },
            {
              label: t("dissolveRoomAction"),
              variant: "danger",
              onSelect: () => void dissolve(),
            },
          ]}
        >
          <p className="leave-dialog-copy">{t("dissolveRoomDescription")}</p>
        </Dialog>
      )}
      {gameHelpOpen && gameHelpHref && (
        <GameHelpDialog
          name={gameName}
          url={gameHelpHref}
          onClose={() => setGameHelpOpen(false)}
        />
      )}
      {changeGameOpen && (
        <ChangeGameDialog
          onClose={() => setChangeGameOpen(false)}
          onSubmit={(url) => void changeGame(url)}
        />
      )}
      {phase === "lobby" && lobbyMenuOpen && lobbyMenuAnchor && (
        <Menu
          ariaLabel={t("roomOptions")}
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
            {t("gameInfo")}
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
              {t("gameHelp")}
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
              {t("changeGame")}
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
              {t("dissolveRoomAction")}
            </button>
          )}
        </Menu>
      )}
      {gameInfoOpen && gameUrl && game && (
        <GameInfoPanel
          actions={phase === "playing" ? gameInfoActions : undefined}
          icon={gameIconHref}
          isFavorite={isFavorite}
          manifestUrl={game.manifestUrl}
          name={gameName}
          url={game.url}
          onClose={() => setGameInfoOpen(false)}
          onShowHelp={gameHelpHref ? () => setGameHelpOpen(true) : undefined}
          onRefresh={
            phase === "playing"
              ? () => setGameRevision((revision) => revision + 1)
              : undefined
          }
          onToggleFavorite={
            phase === "playing"
              ? () => setIsFavorite(toggleFavoriteGame(game))
              : undefined
          }
        />
      )}
      {phase === "playing" && (
        <>
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

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function actionFromRpcParams(params: JsonValue | undefined): JsonValue {
  if (
    params === null ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    !("action" in params) ||
    !isJson(params.action)
  ) {
    throw new RpcFault(
      JsonRpcErrorCode.InvalidParams,
      "room.action params must contain a JSON-compatible action",
      { code: "INVALID_ACTION_PARAMS", retryable: false },
    );
  }
  return params.action;
}

function actionResultForRpc(result: RoomActionResult): JsonValue {
  return result.accepted
    ? {
        accepted: true,
        matchId: result.matchId,
        version: result.version,
      }
    : {
        accepted: false,
        matchId: result.matchId,
        version: result.version,
        error: {
          code: result.error.code,
          message: result.error.message,
        },
      };
}

import { DurableObject } from "cloudflare:workers";
import { assertJson, assertJsonSize, JsonValidationError, type JsonValue, type RoomLobby, type RoomPlayer, type RoomSnapshot } from "@playweft/game-protocol";
import { GameRuntimeError, type GameRuntime } from "@playweft/runtime-core";
import type { Env } from "./env";
import { createRuntime, isRuntimeKind, type RuntimeKind } from "./runtime-registry";

const MAX_ACTION_BYTES = 8 * 1024;
const MAX_PLAYER_ID_LENGTH = 64;
const MAX_STATE_BYTES = 64 * 1024;
const ROOM_IDLE_TTL_MS = 60 * 60 * 1_000;
const MAX_PLAYERS = 32;

interface RoomConfig {
  runtime: RuntimeKind;
  script: string;
  scriptHash: string;
  minPlayers: number;
  maxPlayers: number;
}

interface RoomLaunch {
  gameUrl: string;
}

interface RoomState {
  state: JsonValue;
  version: number;
}

interface SocketAttachment {
  playerId: string;
  actorId: string;
}

interface RoomMember {
  actorId: string;
  joinedAt: number;
}

class RoomHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One Durable Object is one authoritative game room. It serializes every
 * mutation, executes the room's selected game runtime, then persists and broadcasts the
 * resulting state before accepting the next action.
 */
export class GameRoom extends DurableObject<Env> {
  private runtime?: { kind: RuntimeKind; scriptHash: string; engine: GameRuntime };
  private tail: Promise<void> = Promise.resolve();

  async fetch(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      switch (`${request.method} ${path}`) {
        case "POST /create":
          return Response.json(await this.enqueue(() => this.create(request)));
        case "GET /launch":
          return Response.json(await this.enqueue(() => this.launch()));
        case "GET /state":
          return Response.json(await this.enqueue(() => this.stateFor(request)));
        case "PUT /initialize":
          return Response.json(await this.enqueue(() => this.initialize(request)));
        case "POST /join":
          return Response.json(await this.enqueue(() => this.join(request)));
        case "POST /start":
          return Response.json(await this.enqueue(() => this.start(request)));
        case "POST /kick":
          return Response.json(await this.enqueue(() => this.kick(request)));
        case "POST /actions":
          return Response.json(await this.enqueue(() => this.applyAction(request)));
        case "GET /connect":
          return this.connectWebSocket(request);
        default:
          return this.jsonError(404, "unknown room endpoint");
      }
    } catch (error) {
      return this.handleError(error);
    }
  }

  async alarm(): Promise<void> {
    const [gameUrl, lastActivity] = await Promise.all([
      this.ctx.storage.get<string>("gameUrl"),
      this.ctx.storage.get<number>("lastActivity"),
    ]);
    if (!gameUrl) {
      await this.ctx.storage.deleteAll();
      return;
    }
    if (this.ctx.getWebSockets().length > 0) {
      await this.touch();
      return;
    }
    const expiresAt = (lastActivity ?? 0) + ROOM_IDLE_TTL_MS;
    if (Date.now() >= expiresAt) {
      this.disposeRuntime();
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(expiresAt);
  }

  async webSocketMessage(webSocket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      if (typeof message !== "string") throw new RoomHttpError(400, "messages must be JSON text");
      const input = parseJson(message);
      if (!isRecord(input) || input.type !== "action") {
        throw new RoomHttpError(400, "expected { type: 'action', action }");
      }
      const attachment = webSocket.deserializeAttachment() as SocketAttachment | null;
      await this.enqueue(() => this.applyActionInput({
        playerId: attachment?.playerId ?? "",
        actorId: attachment?.actorId ?? "anonymous",
        action: input.action,
      }));
    } catch (error) {
      webSocket.send(JSON.stringify({ type: "error", error: errorMessage(error) }));
    }
  }

  private async create(request: Request): Promise<RoomLaunch> {
    const input = await parseRequestJson(request);
    if (!isRecord(input) || typeof input.gameUrl !== "string") {
      throw new RoomHttpError(400, "expected { gameUrl }");
    }
    const gameUrl = normalizeGameUrl(input.gameUrl);
    const existing = await this.ctx.storage.get<string>("gameUrl");
    if (existing !== undefined) {
      throw new RoomHttpError(409, "room has already been created");
    }
    await this.ctx.storage.put({
      gameUrl,
      ownerPlayerId: this.playerId(request),
      phase: "lobby",
    });
    await this.touch();
    return { gameUrl };
  }

  private async launch(): Promise<RoomLaunch> {
    const gameUrl = await this.ctx.storage.get<string>("gameUrl");
    if (!gameUrl) throw new RoomHttpError(404, "room does not exist");
    await this.touch();
    return { gameUrl };
  }

  private async initialize(request: Request): Promise<RoomLobby> {
    await this.launch();
    const input = await parseRequestJson(request);
    if (!isRecord(input) || typeof input.script !== "string") {
      throw new RoomHttpError(400, "expected { runtime?: 'lua', script, minPlayers, maxPlayers }");
    }

    const runtime = input.runtime ?? "lua";
    if (typeof runtime !== "string" || !isRuntimeKind(runtime)) {
      throw new RoomHttpError(400, "runtime must be a supported runtime kind");
    }

    const minPlayers = validatePlayerLimit(input.minPlayers, "minPlayers");
    const maxPlayers = validatePlayerLimit(input.maxPlayers, "maxPlayers");
    if (minPlayers > maxPlayers) throw new RoomHttpError(400, "minPlayers must not exceed maxPlayers");

    const scriptHash = await hash(input.script);
    const existing = await this.storedConfig();
    if (existing) {
      if (existing.scriptHash !== scriptHash || existing.minPlayers !== minPlayers || existing.maxPlayers !== maxPlayers) {
        throw new RoomHttpError(409, "room is already initialized with a different game configuration");
      }
      return this.lobby();
    }

    const engine = await createRuntime(runtime, input.script);
    try {
      // Compile once now so an invalid script fails before anybody joins.
      // setup() runs only after the platform locks the roster at game start.
      await this.ctx.storage.put({
        runtime,
        script: input.script,
        scriptHash,
        minPlayers,
        maxPlayers,
      });
      await this.touch();
      return this.lobby();
    } catch (error) {
      throw error;
    } finally {
      engine.dispose();
    }
  }

  private async join(request: Request): Promise<RoomLobby & { selfId: string }> {
    await this.launch();
    const config = await this.config();
    const playerId = this.playerId(request);
    const phase = await this.phase();
    const members = await this.members();
    const existing = members[playerId];
    if (!existing) {
      if (phase === "playing") throw new RoomHttpError(403, "the game has already started");
      if (Object.keys(members).length >= config.maxPlayers) throw new RoomHttpError(409, "the room is full");
      members[playerId] = { actorId: await this.actorId(request), joinedAt: Date.now() };
      await this.ctx.storage.put("members", members);
      await this.touch();
      this.broadcast(await this.lobby());
    }
    return { ...await this.lobby(), selfId: members[playerId]!.actorId };
  }

  private async start(request: Request): Promise<RoomSnapshot> {
    await this.launch();
    const playerId = this.playerId(request);
    if (playerId !== await this.ownerPlayerId()) throw new RoomHttpError(403, "only the room host can start the game");
    if (await this.phase() !== "lobby") throw new RoomHttpError(409, "the game has already started");

    const [config, members] = await Promise.all([this.config(), this.members()]);
    const players = Object.values(members).sort((a, b) => a.joinedAt - b.joinedAt).map((member) => member.actorId);
    if (players.length < config.minPlayers) throw new RoomHttpError(409, `waiting for at least ${config.minPlayers} players`);
    const engine = await this.engine(config);
    const state = engine.setup({ players });
    assertJsonSize(state, "initial state", MAX_STATE_BYTES);
    const snapshot: RoomSnapshot = { type: "snapshot", state, version: 0, scriptHash: config.scriptHash };
    await this.ctx.storage.put<JsonValue>({ phase: "playing", state, version: 0 });
    await this.touch();
    this.broadcast(snapshot);
    return snapshot;
  }

  private async kick(request: Request): Promise<RoomLobby> {
    await this.launch();
    const playerId = this.playerId(request);
    if (playerId !== await this.ownerPlayerId()) throw new RoomHttpError(403, "only the room host can remove players");
    if (await this.phase() !== "lobby") throw new RoomHttpError(409, "players cannot be removed after the game starts");
    const input = await parseRequestJson(request);
    if (!isRecord(input) || typeof input.playerId !== "string") throw new RoomHttpError(400, "expected { playerId }");

    const members = await this.members();
    const target = Object.entries(members).find(([, member]) => member.actorId === input.playerId);
    if (!target) throw new RoomHttpError(404, "player is not in this room");
    if (target[0] === playerId) throw new RoomHttpError(409, "the room host cannot remove themselves");
    delete members[target[0]];
    await this.ctx.storage.put("members", members);
    await this.touch();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as SocketAttachment | null;
      if (attachment?.playerId !== target[0]) continue;
      try {
        socket.send(JSON.stringify({ type: "error", error: "you were removed from the room" }));
        socket.close(4003, "removed from room");
      } catch {
        // The peer may have disconnected while the host was removing them.
      }
    }
    const lobby = await this.lobby();
    this.broadcast(lobby);
    return lobby;
  }

  private async applyAction(request: Request): Promise<object> {
    await this.launch();
    const input = await parseRequestJson(request);
    if (!isRecord(input) || !("action" in input)) {
      throw new RoomHttpError(400, "expected { action }");
    }
    const playerId = this.playerId(request);
    return this.applyActionInput({ playerId, actorId: await this.memberActorId(playerId), action: input.action });
  }

  private async applyActionInput(input: { playerId: string; actorId: string; action: unknown }): Promise<object> {
    if (!input.actorId || input.actorId.length > MAX_PLAYER_ID_LENGTH) {
      throw new RoomHttpError(400, `actorId must be 1-${MAX_PLAYER_ID_LENGTH} characters`);
    }
    if (await this.phase() !== "playing") throw new RoomHttpError(409, "the game has not started");
    if (await this.memberActorId(input.playerId) !== input.actorId) {
      throw new RoomHttpError(403, "player is not in this game");
    }
    assertJson(input.action, "action");
    assertJsonSize(input.action, "action", MAX_ACTION_BYTES);

    const config = await this.config();
    const room = await this.roomState();
    const engine = await this.engine(config);
    const result = engine.applyAction(room.state, input.action, {
      playerId: input.actorId,
      version: room.version,
    });
    const version = room.version + 1;
    await this.ctx.storage.put<JsonValue>({ state: result.state, version });
    await this.touch();

    const update = {
      type: "state",
      state: result.state,
      events: result.events,
      version,
      scriptHash: config.scriptHash,
    };
    this.broadcast(update);
    return update;
  }

  private async snapshot(): Promise<RoomSnapshot> {
    const [config, room] = await Promise.all([this.config(), this.roomState()]);
    return { type: "snapshot", state: room.state, version: room.version, scriptHash: config.scriptHash };
  }

  private async stateFor(request: Request): Promise<RoomSnapshot> {
    await this.memberActorId(this.playerId(request));
    if (await this.phase() !== "playing") throw new RoomHttpError(409, "the game has not started");
    return this.snapshot();
  }

  private async connectWebSocket(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      throw new RoomHttpError(426, "expected WebSocket upgrade");
    }
    const attachment = await this.enqueue(async () => {
      await this.launch();
      const playerId = this.playerId(request);
      return { playerId, actorId: await this.memberActorId(playerId) } satisfies SocketAttachment;
    });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);
    this.ctx.waitUntil(this.enqueue(async () => {
      try {
        server.send(JSON.stringify((await this.phase()) === "playing" ? await this.snapshot() : await this.lobby()));
      } catch (error) {
        server.send(JSON.stringify({ type: "error", error: errorMessage(error) }));
      }
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async config(): Promise<RoomConfig> {
    const config = await this.storedConfig();
    if (!config) {
      throw new RoomHttpError(409, "room has no valid game runtime; initialize it first");
    }
    return config;
  }

  private async storedConfig(): Promise<RoomConfig | undefined> {
    const [runtime, script, scriptHash, minPlayers, maxPlayers] = await Promise.all([
      this.ctx.storage.get<string>("runtime"),
      this.ctx.storage.get<string>("script"),
      this.ctx.storage.get<string>("scriptHash"),
      this.ctx.storage.get<number>("minPlayers"),
      this.ctx.storage.get<number>("maxPlayers"),
    ]);
    if (runtime === undefined && script === undefined && scriptHash === undefined && minPlayers === undefined && maxPlayers === undefined) return undefined;
    if (!runtime || !isRuntimeKind(runtime) || !script || !scriptHash || !isPlayerLimit(minPlayers) || !isPlayerLimit(maxPlayers) || minPlayers > maxPlayers) {
      throw new RoomHttpError(500, "room has invalid persisted game configuration");
    }
    return { runtime, script, scriptHash, minPlayers, maxPlayers };
  }

  private async roomState(): Promise<RoomState> {
    const [state, version] = await Promise.all([
      this.ctx.storage.get<JsonValue>("state"),
      this.ctx.storage.get<number>("version"),
    ]);
    if (state === undefined || version === undefined) {
      throw new RoomHttpError(409, "room has no persisted state; initialize it first");
    }
    return { state, version };
  }

  private async engine(config: RoomConfig): Promise<GameRuntime> {
    if (this.runtime?.kind === config.runtime && this.runtime.scriptHash === config.scriptHash) return this.runtime.engine;
    this.disposeRuntime();
    const engine = await createRuntime(config.runtime, config.script);
    this.runtime = { kind: config.runtime, scriptHash: config.scriptHash, engine };
    return engine;
  }

  private disposeRuntime(): void {
    this.runtime?.engine.dispose();
    this.runtime = undefined;
  }

  private async touch(): Promise<void> {
    const now = Date.now();
    await this.ctx.storage.put("lastActivity", now);
    await this.ctx.storage.setAlarm(now + ROOM_IDLE_TTL_MS);
  }

  private broadcast(message: object): void {
    const serialized = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(serialized);
      } catch {
        // A peer may close between getWebSockets() and send().
      }
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private handleError(error: unknown): Response {
    if (error instanceof RoomHttpError) return this.jsonError(error.status, error.message);
    if (error instanceof JsonValidationError) return this.jsonError(422, error.message);
    if (error instanceof GameRuntimeError) return this.jsonError(422, error.message);
    console.error("room request failed", error);
    return this.jsonError(500, "internal room error");
  }

  private jsonError(status: number, error: string): Response {
    return Response.json({ error }, { status });
  }

  private playerId(request: Request): string {
    const playerId = request.headers.get("X-Playweft-Player-Id");
    if (!playerId || playerId.length > MAX_PLAYER_ID_LENGTH) {
      throw new RoomHttpError(401, "trusted platform identity is required");
    }
    return playerId;
  }

  private async actorId(request: Request): Promise<string> {
    const playerId = this.playerId(request);
    const actors = (await this.ctx.storage.get<Record<string, string>>("actors")) ?? {};
    const existing = actors[playerId];
    if (existing) return existing;

    const actorId = `actor_${crypto.randomUUID().replaceAll("-", "")}`;
    actors[playerId] = actorId;
    await this.ctx.storage.put("actors", actors);
    return actorId;
  }

  private async members(): Promise<Record<string, RoomMember>> {
    return (await this.ctx.storage.get<Record<string, RoomMember>>("members")) ?? {};
  }

  private async memberActorId(playerId: string): Promise<string> {
    const member = (await this.members())[playerId];
    if (!member) throw new RoomHttpError(403, "join the room before playing");
    return member.actorId;
  }

  private async ownerPlayerId(): Promise<string> {
    const ownerPlayerId = await this.ctx.storage.get<string>("ownerPlayerId");
    if (!ownerPlayerId) throw new RoomHttpError(500, "room has no owner");
    return ownerPlayerId;
  }

  private async phase(): Promise<"lobby" | "playing"> {
    const phase = await this.ctx.storage.get<string>("phase") ?? "lobby";
    if (phase !== "lobby" && phase !== "playing") throw new RoomHttpError(500, "room has invalid phase");
    return phase;
  }

  private async lobby(): Promise<RoomLobby> {
    const [config, phase, members, ownerPlayerId] = await Promise.all([
      this.config(),
      this.phase(),
      this.members(),
      this.ownerPlayerId(),
    ]);
    const players: RoomPlayer[] = Object.values(members)
      .sort((left, right) => left.joinedAt - right.joinedAt)
      .map((member) => ({ id: member.actorId }));
    return {
      type: "lobby",
      phase,
      players,
      ownerId: members[ownerPlayerId]?.actorId ?? "",
      minPlayers: config.minPlayers,
      maxPlayers: config.maxPlayers,
    };
  }
}

function normalizeGameUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RoomHttpError(400, "gameUrl must be an absolute URL");
  }
  const isLocalHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new RoomHttpError(400, "gameUrl must use HTTPS (or localhost HTTP during development)");
  }
  if (url.username || url.password) throw new RoomHttpError(400, "gameUrl must not include credentials");
  return url.toString();
}

function validatePlayerLimit(value: unknown, label: string): number {
  if (!isPlayerLimit(value)) throw new RoomHttpError(400, `${label} must be an integer from 1 to ${MAX_PLAYERS}`);
  return value;
}

function isPlayerLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_PLAYERS;
}

async function parseRequestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new RoomHttpError(400, "request body must be valid JSON");
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new RoomHttpError(400, "message must be valid JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "internal room error";
}

async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

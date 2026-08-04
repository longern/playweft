export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JSON_MAX_DEPTH = 32;

export class JsonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonValidationError";
  }
}

export function assertJson(value: unknown, label: string): asserts value is JsonValue {
  if (!isJson(value)) throw new JsonValidationError(`${label} must be JSON-compatible`);
}

export function assertJsonSize(value: JsonValue, label: string, maxBytes: number): void {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > maxBytes) throw new JsonValidationError(`${label} exceeds the ${maxBytes}-byte limit`);
}

export function isJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > JSON_MAX_DEPTH) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, item]) => key.length <= 256 && isJson(item, depth + 1),
  );
}

export const JSON_RPC_VERSION = "2.0" as const;
export const PLAYWEFT_BRIDGE_VERSION = 1 as const;
export const GAME_MANIFEST_VERSION = 1 as const;

export interface GameManifestTranslation {
  name: string;
  description?: string;
  category?: string;
}

export interface GameManifestDisplay {
  defaultLocale: string;
  locales: Record<string, GameManifestTranslation>;
  icon?: string;
  help?: string;
}

export interface GameManifestRoomMode {
  players: {
    min: number;
    max: number;
  };
  server: {
    runtime: "lua";
    entry: string;
    persistence: "durable" | "live";
  };
}

export interface GameManifest {
  $schema?: string;
  manifestVersion: typeof GAME_MANIFEST_VERSION;
  id: string;
  version: string;
  protocol: {
    min: number;
    max: number;
  };
  client: {
    entry: string;
  };
  display: GameManifestDisplay;
  modes: {
    solo?: Record<string, never>;
    room?: GameManifestRoomMode;
  };
  permissions?: {
    "clipboard.readText"?: {
      reason?: string;
    };
  };
}

export class GameManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameManifestValidationError";
  }
}

export function parseGameManifest(value: unknown): GameManifest {
  if (!isRecord(value)) failManifest("manifest must be an object");
  const manifest = value as Record<string, unknown>;
  assertManifestKeys(manifest, [
    "$schema",
    "manifestVersion",
    "id",
    "version",
    "protocol",
    "client",
    "display",
    "modes",
    "permissions",
  ], "manifest");
  if (manifest.manifestVersion !== GAME_MANIFEST_VERSION) {
    failManifest(`manifestVersion must be ${GAME_MANIFEST_VERSION}`);
  }
  if (
    typeof manifest.id !== "string" ||
    !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(manifest.id) ||
    manifest.id.length > 128
  ) {
    failManifest("id must be a reverse-domain identifier");
  }
  if (
    typeof manifest.version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      manifest.version,
    ) ||
    manifest.version.length > 64
  ) {
    failManifest("version must be a semantic version");
  }
  if (!isRecord(manifest.protocol)) failManifest("protocol must be an object");
  const protocol = manifest.protocol as Record<string, unknown>;
  assertManifestKeys(protocol, ["min", "max"], "protocol");
  if (
    !isProtocolVersion(protocol.min) ||
    !isProtocolVersion(protocol.max) ||
    protocol.min > protocol.max
  ) {
    failManifest("protocol min/max must be ordered positive integers");
  }

  const display = parseManifestDisplay(manifest.display);
  if (!isRecord(manifest.client)) failManifest("client must be an object");
  const client = manifest.client as Record<string, unknown>;
  assertManifestKeys(client, ["entry"], "client");
  if (!isRelativeOrWebUrl(client.entry, 2_048)) {
    failManifest("client.entry must be a relative or HTTPS URL");
  }
  const modes = parseManifestModes(manifest.modes);
  const permissions = parseManifestPermissions(manifest.permissions);
  if (manifest.$schema !== undefined && typeof manifest.$schema !== "string") {
    failManifest("$schema must be a string");
  }
  return {
    ...(typeof manifest.$schema === "string"
      ? { $schema: manifest.$schema }
      : {}),
    manifestVersion: GAME_MANIFEST_VERSION,
    id: manifest.id as string,
    version: manifest.version as string,
    protocol: {
      min: protocol.min as number,
      max: protocol.max as number,
    },
    client: {
      entry: client.entry as string,
    },
    display,
    modes,
    ...(permissions ? { permissions } : {}),
  };
}

function parseManifestDisplay(value: unknown): GameManifestDisplay {
  if (!isRecord(value)) failManifest("display must be an object");
  const display = value as Record<string, unknown>;
  assertManifestKeys(
    display,
    ["defaultLocale", "locales", "icon", "help"],
    "display",
  );
  if (
    typeof display.defaultLocale !== "string" ||
    !isLocaleTag(display.defaultLocale)
  ) {
    failManifest("display.defaultLocale must be a valid locale tag");
  }
  if (!isRecord(display.locales)) {
    failManifest("display.locales must be an object");
  }
  const localeEntries = Object.entries(display.locales);
  if (
    localeEntries.length === 0 ||
    localeEntries.length > 32 ||
    !Object.prototype.hasOwnProperty.call(
      display.locales,
      display.defaultLocale,
    )
  ) {
    failManifest("display.locales must include defaultLocale");
  }
  const locales: Record<string, GameManifestTranslation> = {};
  for (const [locale, translation] of localeEntries) {
    if (!isLocaleTag(locale) || !isRecord(translation)) {
      failManifest(`invalid display locale: ${locale}`);
    }
    const item = translation as Record<string, unknown>;
    assertManifestKeys(
      item,
      ["name", "description", "category"],
      `display.locales.${locale}`,
    );
    if (!isTrimmedText(item.name, 1, 100)) {
      failManifest(`display.locales.${locale}.name is invalid`);
    }
    if (
      item.description !== undefined &&
      !isTrimmedText(item.description, 1, 500)
    ) {
      failManifest(`display.locales.${locale}.description is invalid`);
    }
    if (
      item.category !== undefined &&
      !isTrimmedText(item.category, 1, 100)
    ) {
      failManifest(`display.locales.${locale}.category is invalid`);
    }
    locales[locale] = {
      name: item.name as string,
      ...(typeof item.description === "string"
        ? { description: item.description }
        : {}),
      ...(typeof item.category === "string"
        ? { category: item.category }
        : {}),
    };
  }
  if (
    display.icon !== undefined &&
    !isRelativeOrWebUrl(display.icon, 2_048)
  ) {
    failManifest("display.icon must be a relative or HTTPS URL");
  }
  if (
    display.help !== undefined &&
    !isRelativeOrWebUrl(display.help, 2_048)
  ) {
    failManifest("display.help must be a relative or HTTPS URL");
  }
  return {
    defaultLocale: display.defaultLocale as string,
    locales,
    ...(typeof display.icon === "string" ? { icon: display.icon } : {}),
    ...(typeof display.help === "string" ? { help: display.help } : {}),
  };
}

function parseManifestModes(value: unknown): GameManifest["modes"] {
  if (!isRecord(value)) failManifest("modes must be an object");
  const modes = value as Record<string, unknown>;
  assertManifestKeys(modes, ["solo", "room"], "modes");
  const hasSolo = modes.solo !== undefined;
  const hasRoom = modes.room !== undefined;
  if (!hasSolo && !hasRoom) failManifest("modes must declare solo or room");
  if (hasSolo && (!isRecord(modes.solo) || Object.keys(modes.solo).length > 0)) {
    failManifest("modes.solo must be an empty object");
  }
  let room: GameManifestRoomMode | undefined;
  if (hasRoom) {
    if (!isRecord(modes.room)) failManifest("modes.room must be an object");
    const input = modes.room as Record<string, unknown>;
    assertManifestKeys(input, ["players", "server"], "modes.room");
    if (!isRecord(input.players)) {
      failManifest("modes.room.players must be an object");
    }
    const players = input.players as Record<string, unknown>;
    assertManifestKeys(players, ["min", "max"], "modes.room.players");
    if (
      !isPlayerLimit(players.min) ||
      !isPlayerLimit(players.max) ||
      players.min > players.max
    ) {
      failManifest("room player limits must be ordered integers from 1 to 32");
    }
    if (!isRecord(input.server)) {
      failManifest("modes.room.server must be an object");
    }
    const server = input.server as Record<string, unknown>;
    assertManifestKeys(
      server,
      ["runtime", "entry", "persistence"],
      "modes.room.server",
    );
    if (
      server.runtime !== "lua" ||
      !isRelativeOrWebUrl(server.entry, 2_048) ||
      (server.persistence !== "durable" && server.persistence !== "live")
    ) {
      failManifest(
        "modes.room.server requires a Lua entry and durable or live persistence",
      );
    }
    room = {
      players: {
        min: players.min as number,
        max: players.max as number,
      },
      server: {
        runtime: "lua",
        entry: server.entry as string,
        persistence: server.persistence as "durable" | "live",
      },
    };
  }
  return {
    ...(hasSolo ? { solo: {} } : {}),
    ...(room ? { room } : {}),
  };
}

function parseManifestPermissions(
  value: unknown,
): GameManifest["permissions"] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) failManifest("permissions must be an object");
  const permissions = value as Record<string, unknown>;
  for (const key of Object.keys(permissions)) {
    if (key !== "clipboard.readText") {
      failManifest(`unsupported permission: ${key}`);
    }
  }
  if (permissions["clipboard.readText"] === undefined) return {};
  const clipboard = permissions["clipboard.readText"];
  if (!isRecord(clipboard)) {
    failManifest("permissions.clipboard.readText must be an object");
  }
  assertManifestKeys(
    clipboard,
    ["reason"],
    "permissions.clipboard.readText",
  );
  const reason = (clipboard as Record<string, unknown>).reason;
  if (reason !== undefined && !isTrimmedText(reason, 1, 160)) {
    failManifest("clipboard permission reason must contain 1-160 characters");
  }
  return {
    "clipboard.readText": {
      ...(typeof reason === "string" ? { reason } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertManifestKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) failManifest(`${label} contains unknown field: ${unexpected}`);
}

function isProtocolVersion(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 255
  );
}

function isPlayerLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 32
  );
}

function isLocaleTag(value: string): boolean {
  return value.length <= 35 && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value);
}

function isTrimmedText(
  value: unknown,
  minLength: number,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function isRelativeOrWebUrl(value: unknown, maxLength: number): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value
  ) {
    return false;
  }
  try {
    const url = new URL(value, "https://manifest.invalid/");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function failManifest(message: string): never {
  throw new GameManifestValidationError(message);
}

export interface JsonRpcRequest {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcNotification {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcSuccess {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string | null;
  result: JsonValue;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: JsonValue;
}

export interface JsonRpcFailure {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: string | null;
  error: JsonRpcErrorObject;
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcFailure;

export const JsonRpcErrorCode = {
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  PlatformError: -32000,
} as const;

export interface RoomSnapshot {
  type: "snapshot" | "state";
  state: JsonValue;
  matchId: string;
  version: number;
  serverTime: number;
  scriptHash: string;
  events?: JsonValue[];
}

export interface ActionError {
  code: string;
  message: string;
}

export type RoomActionResult =
  | {
      type: "action-result";
      requestId: string;
      accepted: true;
      matchId: string;
      version: number;
    }
  | {
      type: "action-result";
      requestId: string;
      accepted: false;
      matchId: string;
      version: number;
      error: ActionError;
    };

export interface RoomActionResponse {
  result: RoomActionResult;
  /** Present when this request produced a new authoritative state version. */
  update?: RoomSnapshot;
}

export interface RoomPlayer {
  id: string;
  /** Optional platform display name. Omit it when the player is anonymous. */
  name?: string;
  /** One-based position in the room. Positions remain empty when a player spectates. */
  seat: number;
  ready: boolean;
}

export interface RoomSpectator {
  id: string;
  /** Optional platform display name. Omit it when the spectator is anonymous. */
  name?: string;
  /** Optional platform avatar URL reserved for spectator list presentation. */
  avatarUrl?: string;
}

/** Platform-owned room membership. Game iframes never receive this message. */
export interface RoomLobby {
  type: "lobby";
  phase: "lobby" | "playing";
  players: RoomPlayer[];
  spectators: RoomSpectator[];
  ownerId: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface RoomJoin extends RoomLobby {
  selfId: string;
}

export interface RoomError {
  type: "error";
  error: string;
}

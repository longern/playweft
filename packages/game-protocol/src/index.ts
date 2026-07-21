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

export interface RoomSnapshot {
  type: "snapshot" | "state";
  state: JsonValue;
  version: number;
  scriptHash: string;
  events?: JsonValue[];
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

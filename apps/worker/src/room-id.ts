export const DEFAULT_ROOM_ID_FORMAT = "code:4";
export const DEFAULT_ROOM_ID_MAX_ATTEMPTS = 8;

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGIT_ALPHABET = "0123456789";
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

type RoomIdFormat =
  | { kind: "uuid" }
  | { kind: "code" | "digits" | "base64url"; length: number };

export function roomIdMaxAttempts(value: string | undefined): number {
  if (value === undefined || value.trim() === "")
    return DEFAULT_ROOM_ID_MAX_ATTEMPTS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("ROOM_ID_MAX_ATTEMPTS must be an integer from 1 to 100");
  }
  return parsed;
}

export function generateRoomId(configuredFormat: string | undefined): string {
  const format = roomIdFormat(configuredFormat);
  switch (format.kind) {
    case "uuid":
      return crypto.randomUUID();
    case "code":
      return randomString(CODE_ALPHABET, format.length);
    case "digits":
      return randomString(DIGIT_ALPHABET, format.length);
    case "base64url":
      return randomString(BASE64URL_ALPHABET, format.length);
  }
}

function roomIdFormat(value: string | undefined): RoomIdFormat {
  const configured = (value?.trim() || DEFAULT_ROOM_ID_FORMAT).toLowerCase();
  if (configured === "uuid") return { kind: "uuid" };
  const match = /^(code|digits|base64url):([1-9]\d{0,2})$/.exec(configured);
  if (!match) {
    throw new Error(
      "ROOM_ID_FORMAT must be code:N, digits:N, base64url:N, or uuid",
    );
  }
  const length = Number(match[2]);
  if (length > 128)
    throw new Error("ROOM_ID_FORMAT length must be at most 128");
  return { kind: match[1] as "code" | "digits" | "base64url", length };
}

function randomString(alphabet: string, length: number): string {
  let result = "";
  const maxMultiple = Math.floor(256 / alphabet.length) * alphabet.length;
  const buffer = new Uint8Array(length);
  while (result.length < length) {
    crypto.getRandomValues(buffer);
    for (const value of buffer) {
      if (value >= maxMultiple) continue;
      result += alphabet[value % alphabet.length];
      if (result.length === length) break;
    }
  }
  return result;
}

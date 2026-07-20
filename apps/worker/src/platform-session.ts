import type { Env } from "./env";

const COOKIE_NAME = "playweft_session";
const SESSION_TTL_SECONDS = 24 * 60 * 60;

interface SessionPayload {
  sub: string;
  exp: number;
}

export class PlatformSessionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function issueGuestSession(request: Request, env: Env): Promise<Response> {
  requirePlatformOrigin(request);
  const secret = requireSecret(env);
  const existingToken = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
  const existing = existingToken ? await verify(existingToken, secret) : undefined;
  if (existing && existing.exp > Math.floor(Date.now() / 1000)) {
    return Response.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
  }
  const payload: SessionPayload = {
    sub: `guest_${crypto.randomUUID()}`,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await sign(payload, secret);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return Response.json({ authenticated: true }, {
    headers: {
      "Set-Cookie": `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
      "Cache-Control": "no-store",
    },
  });
}

export async function requirePlatformSession(request: Request, env: Env): Promise<SessionPayload> {
  const token = readCookie(request.headers.get("Cookie"), COOKIE_NAME);
  if (!token) throw new PlatformSessionError(401, "platform session required");
  const payload = await verify(token, requireSecret(env));
  if (!payload || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new PlatformSessionError(401, "platform session is invalid or expired");
  }
  return payload;
}

export function requirePlatformOrigin(request: Request): void {
  const requestOrigin = new URL(request.url).origin;
  if (request.headers.get("Origin") !== requestOrigin) {
    throw new PlatformSessionError(403, "request must originate from the same origin as the platform endpoint");
  }
}

function requireSecret(env: Env): string {
  if (!env.AUTH_SECRET) {
    throw new PlatformSessionError(503, "AUTH_SECRET is not configured");
  }
  return env.AUTH_SECRET;
}

async function sign(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(body, secret);
  return `${body}.${base64Url(signature)}`;
}

async function verify(token: string, secret: string): Promise<SessionPayload | undefined> {
  const [body, signature] = token.split(".");
  if (!body || !signature || !constantTimeEqual(base64UrlDecode(signature), await hmac(body, secret))) return undefined;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as SessionPayload;
    return typeof payload.sub === "string" && typeof payload.exp === "number" ? payload : undefined;
  } catch {
    return undefined;
  }
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function readCookie(header: string | null, name: string): string | undefined {
  return header?.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

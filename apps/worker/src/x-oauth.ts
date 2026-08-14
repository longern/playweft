import type { Env } from "./env";
import {
  authenticatedSessionCookie,
  defaultDisplayName,
  PlatformSessionError,
} from "./platform-session";

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const USER_URL =
  "https://api.x.com/2/users/me?user.fields=profile_image_url";
const OAUTH_COOKIE_NAME = "playweft_x_oauth";
const OAUTH_TTL_SECONDS = 10 * 60;

interface OAuthState {
  state: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

interface XTokenResponse {
  access_token?: unknown;
}

interface XUserResponse {
  data?: {
    id?: unknown;
    name?: unknown;
    profile_image_url?: unknown;
    username?: unknown;
  };
}

export async function startXOAuth(
  request: Request,
  env: Env,
): Promise<Response> {
  const clientId = xClientId(env);
  xClientSecret(env);
  const requestUrl = new URL(request.url);
  const verifier = randomBase64Url(32);
  const state: OAuthState = {
    state: randomBase64Url(24),
    verifier,
    returnTo: safeReturnTo(requestUrl.searchParams.get("return_to")),
    exp: Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS,
  };
  const redirectUri = callbackUrl(request);
  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "tweet.read users.read",
    state: state.state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
  }).toString();

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
      "Set-Cookie": oauthStateCookie(request, encodeState(state)),
      "Cache-Control": "no-store",
    },
  });
}

export async function finishXOAuth(
  request: Request,
  env: Env,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const state = oauthState(request);
  if (!state || state.exp <= Math.floor(Date.now() / 1000)) {
    throw new PlatformSessionError(400, "X login session is missing or expired");
  }
  if (requestUrl.searchParams.get("state") !== state.state) {
    throw new PlatformSessionError(400, "X login state is invalid");
  }
  if (requestUrl.searchParams.has("error")) {
    return redirectAfterOAuth(request, state.returnTo);
  }
  const code = requestUrl.searchParams.get("code");
  if (!code) {
    throw new PlatformSessionError(400, "X authorization code is missing");
  }

  const accessToken = await exchangeCode(request, env, code, state.verifier);
  const user = await fetchXUser(accessToken);
  const sessionCookie = await authenticatedSessionCookie(request, env, {
    sub: `x:${user.id}`,
    provider: "x",
    accountName: user.name,
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    name: defaultDisplayName(user.name),
    username: user.username,
  });
  return redirectAfterOAuth(request, state.returnTo, sessionCookie);
}

async function exchangeCode(
  request: Request,
  env: Env,
  code: string,
  verifier: string,
): Promise<string> {
  const clientId = xClientId(env);
  const clientSecret = xClientSecret(env);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl(request),
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    throw new PlatformSessionError(502, "X token exchange failed");
  }
  const token = (await response.json()) as XTokenResponse;
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new PlatformSessionError(502, "X token response is invalid");
  }
  return token.access_token;
}

async function fetchXUser(accessToken: string): Promise<{
  avatarUrl?: string;
  id: string;
  name: string;
  username: string;
}> {
  const response = await fetch(USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new PlatformSessionError(502, "X user lookup failed");
  }
  const body = (await response.json()) as XUserResponse;
  const user = body.data;
  if (
    typeof user?.id !== "string" ||
    !user.id ||
    typeof user.name !== "string" ||
    !user.name.trim() ||
    typeof user.username !== "string" ||
    !user.username.trim()
  ) {
    throw new PlatformSessionError(502, "X user response is invalid");
  }
  const avatarUrl = httpsUrl(user.profile_image_url);
  return {
    ...(avatarUrl ? { avatarUrl } : {}),
    id: user.id,
    name: user.name.trim(),
    username: user.username.trim(),
  };
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function redirectAfterOAuth(
  request: Request,
  returnTo: string,
  sessionCookie?: string,
): Response {
  const headers = new Headers({
    Location: new URL(returnTo, request.url).toString(),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", expiredOAuthStateCookie(request));
  if (sessionCookie) headers.append("Set-Cookie", sessionCookie);
  return new Response(null, { status: 302, headers });
}

function callbackUrl(request: Request): string {
  return new URL("/api/auth/x/callback", request.url).toString();
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function xClientId(env: Env): string {
  if (!env.X_CLIENT_ID) {
    throw new PlatformSessionError(503, "X_CLIENT_ID is not configured");
  }
  return env.X_CLIENT_ID;
}

function xClientSecret(env: Env): string {
  if (!env.X_CLIENT_SECRET) {
    throw new PlatformSessionError(503, "X_CLIENT_SECRET is not configured");
  }
  return env.X_CLIENT_SECRET;
}

function oauthState(request: Request): OAuthState | undefined {
  const value = readCookie(
    request.headers.get("Cookie"),
    OAUTH_COOKIE_NAME,
  );
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(value)),
    ) as Record<string, unknown>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.returnTo !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return undefined;
    }
    return {
      state: parsed.state,
      verifier: parsed.verifier,
      returnTo: safeReturnTo(parsed.returnTo),
      exp: parsed.exp,
    };
  } catch {
    return undefined;
  }
}

function encodeState(state: OAuthState): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(state)));
}

function oauthStateCookie(request: Request, value: string): string {
  return `${OAUTH_COOKIE_NAME}=${value}; Path=/api/auth/x; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_TTL_SECONDS}${secureAttribute(request)}`;
}

function expiredOAuthStateCookie(request: Request): string {
  return `${OAUTH_COOKIE_NAME}=; Path=/api/auth/x; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute(request)}`;
}

function secureAttribute(request: Request): string {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function readCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function base64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) =>
    character.charCodeAt(0),
  );
}

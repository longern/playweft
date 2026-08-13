import {
  GAME_MANIFEST_VERSION,
  PLAYWEFT_BRIDGE_VERSION,
  parseGameManifest,
  type GameManifest,
  type GameManifestIcon,
  type GameManifestLocalizedText,
  type GameManifestOrientation,
} from "@playweft/game-protocol";
import {
  isGameTranslations,
  type GameTranslations,
} from "./i18n";

export type GameMode = "solo" | "room";

export interface DiscoveredGame {
  url: string;
  manifestUrl: string;
  manifestId: string;
  version: string;
  name: string;
  translations?: GameTranslations;
  icon?: string;
  helpUrl?: string;
  description: string;
  category: string;
  backgroundColor?: string;
  themeColor?: string;
  orientation?: GameManifestOrientation;
  modes: GameMode[];
  liveRoom?: boolean;
  permissions: string[];
}

export interface LoadedGame {
  game: DiscoveredGame;
  manifest: GameManifest;
  room?: {
    gameId: string;
    gameVersion: string;
    runtime: "lua";
    serverUrl: string;
    minPlayers: number;
    maxPlayers: number;
    liveRoom: boolean;
  };
}

const MANIFEST_TIMEOUT_MS = 8_000;
const MAX_MANIFEST_BYTES = 64 * 1024;

export function manifestUrlFromInput(value: string): string {
  const url = new URL(value.trim());
  if (/\.json$/i.test(url.pathname)) return url.toString();
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.pathname += "playweft.json";
  return url.toString();
}

export async function loadGameManifest(
  value: string,
): Promise<LoadedGame> {
  const manifestUrl = webUrl(value);
  if (!manifestUrl) {
    throw new Error("Manifest URL must use HTTPS (or localhost HTTP)");
  }
  const manifestValue = await fetchText(
    manifestUrl,
    "application/json",
    MAX_MANIFEST_BYTES,
  ).then((text) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("Game Manifest is not valid JSON");
    }
  });
  const manifest = parseGameManifest(manifestValue);
  if (
    manifest.protocol.min > PLAYWEFT_BRIDGE_VERSION ||
    manifest.protocol.max < PLAYWEFT_BRIDGE_VERSION
  ) {
    throw new Error(
      `Game supports protocol ${manifest.protocol.min}-${manifest.protocol.max}; platform requires ${PLAYWEFT_BRIDGE_VERSION}`,
    );
  }
  const game = discoveredGame(manifest, manifestUrl);
  const roomMode = manifest.modes.room;
  if (!roomMode) return { game, manifest };

  const serverUrl = sameOriginUrl(
    roomMode.server.entry,
    manifestUrl,
    new URL(manifestUrl).origin,
  );
  if (!serverUrl) {
    throw new Error(
      "modes.room.server.entry must resolve to the Manifest origin",
    );
  }
  return {
    game,
    manifest,
    room: {
      gameId: game.manifestId,
      gameVersion: manifest.version,
      runtime: roomMode.server.runtime,
      serverUrl,
      minPlayers: roomMode.players.min,
      maxPlayers: roomMode.players.max,
      liveRoom: roomMode.server.persistence === "live",
    },
  };
}

export function manifestPermissionReason(
  manifest: GameManifest | undefined,
  permission: "navigator.clipboard.readText",
): string | undefined {
  return manifest?.permissions?.[permission]?.reason;
}

export function isStoredDiscoveredGame(value: unknown): value is DiscoveredGame {
  if (!isRecord(value)) return false;
  return (
    typeof value.url === "string" &&
    typeof value.manifestUrl === "string" &&
    typeof value.manifestId === "string" &&
    webUrl(value.manifestId) !== undefined &&
    typeof value.version === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.category === "string" &&
    (value.translations === undefined ||
      isGameTranslations(value.translations)) &&
    (value.icon === undefined || typeof value.icon === "string") &&
    (value.helpUrl === undefined || typeof value.helpUrl === "string") &&
    (value.backgroundColor === undefined ||
      isCssColor(value.backgroundColor)) &&
    (value.themeColor === undefined || isCssColor(value.themeColor)) &&
    (value.orientation === undefined ||
      isStoredOrientation(value.orientation)) &&
    (value.liveRoom === undefined || typeof value.liveRoom === "boolean") &&
    Array.isArray(value.modes) &&
    value.modes.length > 0 &&
    value.modes.every((mode) => mode === "solo" || mode === "room") &&
    Array.isArray(value.permissions) &&
    value.permissions.every((permission) => typeof permission === "string")
  );
}

function discoveredGame(
  manifest: GameManifest,
  manifestUrl: string,
): DiscoveredGame {
  const manifestOrigin = new URL(manifestUrl).origin;
  const clientUrl = sameOriginUrl(
    manifest.start_url,
    manifestUrl,
    manifestOrigin,
  );
  if (!clientUrl) {
    throw new Error("start_url must resolve to the Manifest origin");
  }
  const manifestId = manifestIdentity(manifest.id, clientUrl);
  if (!manifestId) {
    throw new Error("id must resolve to the start_url origin");
  }
  const translations: GameTranslations = {};
  for (const [locale, name] of Object.entries(manifest.name_localized ?? {})) {
    translations[locale] = { name: localizedTextValue(name) };
  }
  for (const [locale, description] of Object.entries(
    manifest.description_localized ?? {},
  )) {
    translations[locale] = {
      ...translations[locale],
      description: localizedTextValue(description),
    };
  }
  const icons = (manifest.icons ?? []).map((icon) => ({
    ...icon,
    src: sameOriginUrl(icon.src, manifestUrl, manifestOrigin),
  }));
  if (icons.some((icon) => !icon.src)) {
    throw new Error("icons[].src must resolve to the Manifest origin");
  }
  const icon = selectGameIcon(
    icons as Array<GameManifestIcon & { src: string }>,
  );
  const helpUrl = manifest.help_url
    ? sameOriginUrl(manifest.help_url, manifestUrl, manifestOrigin)
    : undefined;
  if (manifest.help_url && !helpUrl) {
    throw new Error("help_url must resolve to the Manifest origin");
  }
  assertCssColor(manifest.background_color, "background_color");
  assertCssColor(manifest.theme_color, "theme_color");
  const modes: GameMode[] = [
    ...(manifest.modes.solo ? (["solo"] as const) : []),
    ...(manifest.modes.room ? (["room"] as const) : []),
  ];
  return {
    url: clientUrl,
    manifestUrl,
    manifestId,
    version: manifest.version,
    name: manifest.name,
    ...(Object.keys(translations).length > 0 ? { translations } : {}),
    ...(icon ? { icon } : {}),
    ...(helpUrl ? { helpUrl } : {}),
    description: manifest.description ?? "",
    category: manifest.categories?.[0] ?? "",
    ...(manifest.background_color
      ? { backgroundColor: manifest.background_color }
      : {}),
    ...(manifest.theme_color ? { themeColor: manifest.theme_color } : {}),
    ...(manifest.orientation ? { orientation: manifest.orientation } : {}),
    modes,
    ...(manifest.modes.room?.server.persistence === "live"
      ? { liveRoom: true }
      : {}),
    permissions: Object.keys(manifest.permissions ?? {}),
  };
}

function localizedTextValue(value: GameManifestLocalizedText): string {
  return typeof value === "string" ? value : value.value;
}

function manifestIdentity(value: string, startUrl: string): string | undefined {
  const startOrigin = new URL(startUrl).origin;
  const resolved = sameOriginUrl(value, `${startOrigin}/`, startOrigin);
  if (!resolved) return undefined;
  const identity = new URL(resolved);
  identity.hash = "";
  return identity.toString();
}

function selectGameIcon(
  icons: Array<GameManifestIcon & { src: string }>,
): string | undefined {
  return (
    icons.find((icon) =>
      (icon.purpose ?? "any").split(" ").includes("any"),
    ) ?? icons[0]
  )?.src;
}

function assertCssColor(value: string | undefined, label: string): void {
  if (value !== undefined && !isCssColor(value)) {
    throw new Error(`${label} must be a valid CSS color`);
  }
}

function isCssColor(value: unknown): value is string {
  return typeof value === "string" && CSS.supports("color", value);
}

function isStoredOrientation(value: unknown): value is GameManifestOrientation {
  return (
    value === "any" ||
    value === "natural" ||
    value === "portrait" ||
    value === "portrait-primary" ||
    value === "portrait-secondary" ||
    value === "landscape" ||
    value === "landscape-primary" ||
    value === "landscape-secondary"
  );
}

async function fetchText(
  url: string,
  accept: string,
  maxBytes: number,
): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    MANIFEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      headers: { Accept: accept },
      mode: "cors",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Could not fetch ${url} (${response.status})`);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`Resource exceeds the ${maxBytes}-byte limit`);
    }
    return text;
  } finally {
    window.clearTimeout(timeout);
  }
}

function webUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (url.protocol === "https:" || isLocalHttp) &&
      url.username.length === 0 &&
      url.password.length === 0
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function sameOriginUrl(
  value: string,
  baseUrl: string,
  expectedOrigin: string,
): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    return url.origin === expectedOrigin &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) &&
      url.username.length === 0 &&
      url.password.length === 0
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const GAME_MANIFEST_SCHEMA_VERSION = GAME_MANIFEST_VERSION;

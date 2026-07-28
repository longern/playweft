import {
  GAME_MANIFEST_VERSION,
  PLAYWEFT_BRIDGE_VERSION,
  parseGameManifest,
  type GameManifest,
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
      gameId: manifest.id,
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
  permission: "clipboard.readText",
): string | undefined {
  return manifest?.permissions?.[permission]?.reason;
}

export function isStoredDiscoveredGame(value: unknown): value is DiscoveredGame {
  if (!isRecord(value)) return false;
  return (
    typeof value.url === "string" &&
    typeof value.manifestUrl === "string" &&
    typeof value.manifestId === "string" &&
    typeof value.version === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    typeof value.category === "string" &&
    (value.translations === undefined ||
      isGameTranslations(value.translations)) &&
    (value.icon === undefined || typeof value.icon === "string") &&
    (value.helpUrl === undefined || typeof value.helpUrl === "string") &&
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
    manifest.client.entry,
    manifestUrl,
    manifestOrigin,
  );
  if (!clientUrl) {
    throw new Error("client.entry must resolve to the Manifest origin");
  }
  const defaultTranslation =
    manifest.display.locales[manifest.display.defaultLocale];
  const translations: GameTranslations = {};
  for (const [locale, translation] of Object.entries(
    manifest.display.locales,
  )) {
    if (locale !== manifest.display.defaultLocale) {
      translations[locale] = { name: translation.name };
    }
  }
  const icon = manifest.display.icon
    ? sameOriginUrl(manifest.display.icon, manifestUrl, manifestOrigin)
    : undefined;
  const helpUrl = manifest.display.help
    ? sameOriginUrl(manifest.display.help, manifestUrl, manifestOrigin)
    : undefined;
  if (manifest.display.icon && !icon) {
    throw new Error("display.icon must resolve to the Manifest origin");
  }
  if (manifest.display.help && !helpUrl) {
    throw new Error("display.help must resolve to the Manifest origin");
  }
  const modes: GameMode[] = [
    ...(manifest.modes.solo ? (["solo"] as const) : []),
    ...(manifest.modes.room ? (["room"] as const) : []),
  ];
  return {
    url: clientUrl,
    manifestUrl,
    manifestId: manifest.id,
    version: manifest.version,
    name: defaultTranslation.name,
    ...(Object.keys(translations).length > 0 ? { translations } : {}),
    ...(icon ? { icon } : {}),
    ...(helpUrl ? { helpUrl } : {}),
    description: defaultTranslation.description ?? "",
    category: defaultTranslation.category ?? "",
    modes,
    ...(manifest.modes.room?.server.persistence === "live"
      ? { liveRoom: true }
      : {}),
    permissions: Object.keys(manifest.permissions ?? {}),
  };
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

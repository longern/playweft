import { useEffect, useState } from "react";
import type { GameMode } from "./RoomHost";
import { isGameTranslations, type GameTranslations } from "./i18n";

export interface FeaturedGame {
  name: string;
  translations?: GameTranslations;
  url: string;
  icon?: string;
  description: string;
  category: string;
  modes?: GameMode[];
  liveRoom?: boolean;
}

declare const __PLAYWEFT_FEATURED_GAME_SOURCES__: unknown;

const MAX_LIST_DEPTH = 4;
const MAX_REMOTE_LISTS = 16;
const MAX_REMOTE_LIST_BYTES = 256 * 1024;
const REMOTE_LIST_TIMEOUT_MS = 8_000;

const DEFAULT_FEATURED_GAMES: FeaturedGame[] = [
  {
    name: "Rock Paper Scissors",
    translations: { "zh-CN": { name: "石头剪刀布" } },
    url: "/games/rps/",
    icon: "/games/rps/rps.svg",
    description: "A quick two-player round.",
    category: "Quick match",
    modes: ["room"],
  },
];

const configuredSources = Array.isArray(__PLAYWEFT_FEATURED_GAME_SOURCES__)
  ? __PLAYWEFT_FEATURED_GAME_SOURCES__
  : DEFAULT_FEATURED_GAMES;
const platformBaseUrl = new URL("/", window.location.href).href;

export const FEATURED_GAMES = uniqueGames(
  configuredSources
    .map((source) => featuredGame(source, platformBaseUrl))
    .filter((game): game is FeaturedGame => game !== undefined),
);

let featuredGamesPromise: Promise<FeaturedGame[]> | undefined;

export function useFeaturedGames(): FeaturedGame[] {
  const [games, setGames] = useState(FEATURED_GAMES);

  useEffect(() => {
    let cancelled = false;
    featuredGamesPromise ??= loadFeaturedGames(configuredSources);
    void featuredGamesPromise.then((loaded) => {
      if (!cancelled) setGames(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return games;
}

async function loadFeaturedGames(sources: unknown[]): Promise<FeaturedGame[]> {
  const visited = new Set<string>();
  const games = await resolveSources(sources, platformBaseUrl, visited, 0);
  return uniqueGames(games);
}

async function resolveSources(
  sources: unknown[],
  baseUrl: string,
  visited: Set<string>,
  depth: number,
): Promise<FeaturedGame[]> {
  const groups = await Promise.all(
    sources.map(async (source): Promise<FeaturedGame[]> => {
      if (typeof source !== "string") {
        const game = featuredGame(source, baseUrl);
        if (!game) console.warn("Ignoring an invalid featured game", source);
        return game ? [game] : [];
      }

      let listUrl: URL;
      try {
        listUrl = new URL(source.trim(), baseUrl);
        if (!isWebUrl(listUrl)) throw new Error("unsupported URL protocol");
      } catch (error) {
        console.warn(
          `Ignoring invalid featured-game list URL: ${source}`,
          error,
        );
        return [];
      }
      if (
        depth >= MAX_LIST_DEPTH ||
        visited.has(listUrl.href) ||
        visited.size >= MAX_REMOTE_LISTS
      ) {
        return [];
      }
      visited.add(listUrl.href);

      try {
        const nested = await fetchList(listUrl);
        return resolveSources(nested, listUrl.href, visited, depth + 1);
      } catch (error) {
        console.warn(
          `Could not load featured-game list ${listUrl.href}`,
          error,
        );
        return [];
      }
    }),
  );
  return groups.flat();
}

async function fetchList(url: URL): Promise<unknown[]> {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    REMOTE_LIST_TIMEOUT_MS,
  );
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`request failed (${response.status})`);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REMOTE_LIST_BYTES) {
      throw new Error(`list exceeds the ${MAX_REMOTE_LIST_BYTES}-byte limit`);
    }
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) {
      throw new Error("list must be a JSON array");
    }
    return value;
  } finally {
    window.clearTimeout(timeout);
  }
}

function featuredGame(
  value: unknown,
  baseUrl: string,
): FeaturedGame | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.name !== "string" ||
    input.name.trim().length === 0 ||
    input.name.length > 100 ||
    typeof input.url !== "string" ||
    input.url.trim().length === 0 ||
    typeof input.description !== "string" ||
    input.description.length > 500 ||
    typeof input.category !== "string" ||
    input.category.trim().length === 0 ||
    input.category.length > 100 ||
    (input.translations !== undefined &&
      !isGameTranslations(input.translations)) ||
    (input.icon !== undefined &&
      (typeof input.icon !== "string" || input.icon.trim().length === 0)) ||
    (input.modes !== undefined && !isGameModes(input.modes)) ||
    (input.liveRoom !== undefined && typeof input.liveRoom !== "boolean")
  ) {
    return undefined;
  }

  const url = webUrl(input.url.trim(), baseUrl);
  const icon =
    typeof input.icon === "string"
      ? webUrl(input.icon.trim(), baseUrl)
      : undefined;
  if (!url || (input.icon !== undefined && !icon)) return undefined;
  return {
    name: input.name.trim(),
    url,
    description: input.description,
    category: input.category.trim(),
    ...(input.translations
      ? { translations: input.translations as GameTranslations }
      : {}),
    ...(icon ? { icon } : {}),
    ...(input.modes ? { modes: input.modes as GameMode[] } : {}),
    ...(input.liveRoom === true ? { liveRoom: true } : {}),
  };
}

function webUrl(value: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    return isWebUrl(url) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function isWebUrl(url: URL): boolean {
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  return (
    (url.protocol === "https:" || isLocalHttp) &&
    url.username.length === 0 &&
    url.password.length === 0
  );
}

function isGameModes(value: unknown): value is GameMode[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((mode) => mode === "solo" || mode === "room")
  );
}

function uniqueGames(games: FeaturedGame[]): FeaturedGame[] {
  const urls = new Set<string>();
  return games.filter((game) => {
    if (urls.has(game.url)) return false;
    urls.add(game.url);
    return true;
  });
}

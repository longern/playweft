import { useEffect, useState } from "react";
import {
  loadGameManifest,
  type DiscoveredGame,
} from "./game-manifest";

export type FeaturedGame = DiscoveredGame;

declare const __PLAYWEFT_FEATURED_GAME_SOURCES__: unknown;

const MAX_LIST_DEPTH = 4;
const MAX_REMOTE_LISTS = 16;
const MAX_REMOTE_LIST_BYTES = 256 * 1024;
const REMOTE_LIST_TIMEOUT_MS = 8_000;

const DEFAULT_FEATURED_GAME_SOURCES: unknown[] = [
  { manifestUrl: "/games/rps/playweft.json" },
];

const configuredSources = Array.isArray(__PLAYWEFT_FEATURED_GAME_SOURCES__)
  ? __PLAYWEFT_FEATURED_GAME_SOURCES__
  : DEFAULT_FEATURED_GAME_SOURCES;
const platformBaseUrl = new URL("/", window.location.href).href;

let featuredGamesPromise: Promise<FeaturedGame[]> | undefined;

export function useFeaturedGames(enabled = true): FeaturedGame[] {
  const [games, setGames] = useState<FeaturedGame[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    featuredGamesPromise ??= loadFeaturedGames(configuredSources);
    void featuredGamesPromise.then((loaded) => {
      if (!cancelled) setGames(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

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
      const parsed = parseSource(source, baseUrl);
      if (!parsed) {
        console.warn("Ignoring an invalid featured-game source", source);
        return [];
      }
      if (parsed.kind === "game") {
        try {
          return [(await loadGameManifest(parsed.url)).game];
        } catch (error) {
          console.warn(
            `Could not discover featured game ${parsed.url}`,
            error,
          );
          return [];
        }
      }
      if (
        depth >= MAX_LIST_DEPTH ||
        visited.has(parsed.url) ||
        visited.size >= MAX_REMOTE_LISTS
      ) {
        return [];
      }
      visited.add(parsed.url);
      try {
        const nested = await fetchList(new URL(parsed.url));
        return resolveSources(nested, parsed.url, visited, depth + 1);
      } catch (error) {
        console.warn(
          `Could not load featured-game list ${parsed.url}`,
          error,
        );
        return [];
      }
    }),
  );
  return groups.flat();
}

function parseSource(
  value: unknown,
  baseUrl: string,
): { kind: "game" | "list"; url: string } | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const hasGame = typeof source.manifestUrl === "string";
  const hasList = typeof source.listUrl === "string";
  if (hasGame === hasList) return undefined;
  const rawUrl = hasGame ? source.manifestUrl : source.listUrl;
  const url = webUrl(rawUrl as string, baseUrl);
  return url ? { kind: hasGame ? "game" : "list", url } : undefined;
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
    if (!response.ok) throw new Error(`request failed (${response.status})`);
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REMOTE_LIST_BYTES) {
      throw new Error(`list exceeds the ${MAX_REMOTE_LIST_BYTES}-byte limit`);
    }
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) throw new Error("list must be a JSON array");
    return value;
  } finally {
    window.clearTimeout(timeout);
  }
}

function webUrl(value: string, baseUrl: string): string | undefined {
  try {
    const url = new URL(value.trim(), baseUrl);
    const isLocalHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return (url.protocol === "https:" || isLocalHttp) &&
      url.username.length === 0 &&
      url.password.length === 0
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

function uniqueGames(games: FeaturedGame[]): FeaturedGame[] {
  const ids = new Set<string>();
  return games.filter((game) => {
    if (ids.has(game.manifestId)) return false;
    ids.add(game.manifestId);
    return true;
  });
}

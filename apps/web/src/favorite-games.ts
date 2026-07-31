import {
  isStoredDiscoveredGame,
  type DiscoveredGame,
} from "./game-manifest";

const RECENT_GAMES_KEY = "playweft:recent-games:v1";
const FAVORITE_GAMES_KEY = "playweft:favorite-games:v1";
const MAX_FAVORITE_GAMES = 8;

type StoredGame = DiscoveredGame & { pinned?: boolean };

export function readFavoriteGames(): DiscoveredGame[] {
  const savedFavorites = readStoredGames(FAVORITE_GAMES_KEY).map(normalizeGame);
  const pinnedFavorites = readStoredGames(RECENT_GAMES_KEY)
    .filter((game) => game.pinned)
    .map(normalizeGame);
  const favorites = uniqueGames([...savedFavorites, ...pinnedFavorites]).slice(
    0,
    MAX_FAVORITE_GAMES,
  );
  if (pinnedFavorites.length > 0) persistFavoriteGames(favorites);
  return favorites;
}

export function persistFavoriteGames(
  games: DiscoveredGame[],
): DiscoveredGame[] {
  const next = uniqueGames(games).slice(0, MAX_FAVORITE_GAMES);
  localStorage.setItem(FAVORITE_GAMES_KEY, JSON.stringify(next));
  return next;
}

export function isFavoriteGame(game: DiscoveredGame): boolean {
  return readFavoriteGames().some(
    (favorite) => favorite.manifestId === game.manifestId,
  );
}

export function toggleFavoriteGame(game: DiscoveredGame): boolean {
  const favorites = readFavoriteGames();
  const isFavorite = favorites.some(
    (favorite) => favorite.manifestId === game.manifestId,
  );
  persistFavoriteGames(
    isFavorite
      ? favorites.filter(
          (favorite) => favorite.manifestId !== game.manifestId,
        )
      : [normalizeGame(game), ...favorites],
  );
  return !isFavorite;
}

function readStoredGames(key: string): StoredGame[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is StoredGame =>
        isStoredDiscoveredGame(value) &&
        ((value as StoredGame).pinned === undefined ||
          typeof (value as StoredGame).pinned === "boolean"),
    );
  } catch {
    return [];
  }
}

function normalizeGame(game: DiscoveredGame): DiscoveredGame {
  return {
    ...game,
    url: new URL(game.url, window.location.origin).toString(),
  };
}

function uniqueGames(games: DiscoveredGame[]): DiscoveredGame[] {
  const seenIds = new Set<string>();
  return games.filter((game) => {
    if (seenIds.has(game.manifestId)) return false;
    seenIds.add(game.manifestId);
    return true;
  });
}

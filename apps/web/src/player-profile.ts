const PLAYER_NICKNAME_KEY = "playweft:player-nickname:v1";

export const MAX_PLAYER_NICKNAME_LENGTH = 24;

export function readPlayerNickname(): string {
  try {
    return normalizePlayerNickname(
      localStorage.getItem(PLAYER_NICKNAME_KEY) ?? "",
    );
  } catch {
    return "";
  }
}

export function persistPlayerNickname(value: string): string {
  const nickname = normalizePlayerNickname(value);
  try {
    if (nickname) localStorage.setItem(PLAYER_NICKNAME_KEY, nickname);
    else localStorage.removeItem(PLAYER_NICKNAME_KEY);
  } catch {
    // Keep the in-memory profile usable when storage is unavailable.
  }
  return nickname;
}

export function normalizePlayerNickname(value: string): string {
  return value.trim().slice(0, MAX_PLAYER_NICKNAME_LENGTH);
}

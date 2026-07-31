import { useEffect } from "react";

const GAME_RUNNING_CLASS = "game-running";

export function useGameViewport(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    document.documentElement.classList.add(GAME_RUNNING_CLASS);
    return () => {
      document.documentElement.classList.remove(GAME_RUNNING_CLASS);
    };
  }, [active]);
}

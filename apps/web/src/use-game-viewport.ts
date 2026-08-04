import { useEffect } from "react";

const GAME_RUNNING_CLASS = "game-running";

export function useGameViewport(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    document.documentElement.style.setProperty(
      "--game-scroll-x",
      `${scrollX}px`,
    );
    document.documentElement.style.setProperty(
      "--game-scroll-y",
      `${scrollY}px`,
    );
    document.documentElement.classList.add(GAME_RUNNING_CLASS);
    return () => {
      document.documentElement.classList.remove(GAME_RUNNING_CLASS);
      document.documentElement.style.removeProperty("--game-scroll-x");
      document.documentElement.style.removeProperty("--game-scroll-y");
      window.scrollTo(scrollX, scrollY);
    };
  }, [active]);
}

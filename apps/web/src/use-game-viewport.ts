import { useEffect } from "react";
import type { GameManifestOrientation } from "@playweft/game-protocol";

const GAME_RUNNING_CLASS = "game-running";

export interface GameViewportPreferences {
  backgroundColor?: string;
  themeColor?: string;
  orientation?: GameManifestOrientation;
}

interface LockableScreenOrientation extends ScreenOrientation {
  lock?(orientation: GameManifestOrientation): Promise<void>;
}

export function useGameViewport(
  active: boolean,
  preferences?: GameViewportPreferences,
): void {
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

  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const themeMeta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    );
    const previousThemeColor = themeMeta
      ? themeMeta.getAttribute("content")
      : null;
    if (preferences?.backgroundColor) {
      root.style.setProperty(
        "--game-background-color",
        preferences.backgroundColor,
      );
    }
    if (preferences?.themeColor) {
      root.style.setProperty("--game-theme-color", preferences.themeColor);
      themeMeta?.setAttribute("content", preferences.themeColor);
    }
    return () => {
      root.style.removeProperty("--game-background-color");
      root.style.removeProperty("--game-theme-color");
      if (themeMeta) {
        if (previousThemeColor === null) themeMeta.removeAttribute("content");
        else themeMeta.setAttribute("content", previousThemeColor);
      }
    };
  }, [active, preferences?.backgroundColor, preferences?.themeColor]);

  useEffect(() => {
    const preference = preferences?.orientation;
    if (!active || !preference || preference === "any") return;
    const orientation = screen.orientation as
      | LockableScreenOrientation
      | undefined;
    if (!orientation?.lock) return;
    let activeLock = true;
    let locked = false;
    void orientation
      .lock(preference)
      .then(() => {
        if (activeLock) locked = true;
        else orientation.unlock();
      })
      .catch(() => {
        // Orientation locking is best-effort and is commonly restricted to
        // fullscreen or installed application contexts.
      });
    return () => {
      activeLock = false;
      if (locked) orientation.unlock();
    };
  }, [active, preferences?.orientation]);
}

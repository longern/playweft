import { useCallback, useEffect, useRef, useState } from "react";
import type { GameManifestOrientation } from "@playweft/game-protocol";

const GAME_RUNNING_CLASS = "game-running";
const DEFAULT_GAME_BACKGROUND_COLOR = "#ffffff";
const DEFAULT_GAME_THEME_COLOR = "#70b967";
const WHITE = { red: 255, green: 255, blue: 255 };

interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface GameViewportPreferences {
  backgroundColor?: string;
  themeColor?: string;
  orientation?: GameManifestOrientation;
}

interface LockableScreenOrientation extends ScreenOrientation {
  lock?(orientation: GameManifestOrientation): Promise<void>;
}

export interface GameViewportController {
  orientationAction?: "enter" | "restore";
  enterPreferredOrientation(): Promise<void>;
}

let pendingGameOrientation: Promise<boolean> | undefined;
let gameFullscreenOwned = false;
let gameOrientationLockOwned = false;

function preferredOrientation(
  orientation: GameManifestOrientation | undefined,
): orientation is Exclude<GameManifestOrientation, "any"> {
  return Boolean(orientation && orientation !== "any");
}

function lockableOrientation(): LockableScreenOrientation | undefined {
  return screen.orientation as LockableScreenOrientation | undefined;
}

function supportsMobileOrientationLock(): boolean {
  return Boolean(
    lockableOrientation()?.lock &&
      (navigator.maxTouchPoints > 0 ||
        window.matchMedia("(pointer: coarse)").matches),
  );
}

function renderedColor(value: string, backdrop: RgbColor): RgbColor {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return backdrop;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alphaByte] = context.getImageData(0, 0, 1, 1).data;
  const alpha = alphaByte / 255;
  return {
    red: red * alpha + backdrop.red * (1 - alpha),
    green: green * alpha + backdrop.green * (1 - alpha),
    blue: blue * alpha + backdrop.blue * (1 - alpha),
  };
}

function relativeLuminance({ red, green, blue }: RgbColor): number {
  const linear = (component: number) => {
    const value = component / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return linear(red) * 0.2126 + linear(green) * 0.7152 + linear(blue) * 0.0722;
}

function contrastingTextColor(background: RgbColor): "#000000" | "#ffffff" {
  const luminance = relativeLuminance(background);
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

async function lockGameOrientation(
  orientation: Exclude<GameManifestOrientation, "any">,
): Promise<boolean> {
  const screenOrientation = lockableOrientation();
  if (!screenOrientation?.lock) return false;
  try {
    await screenOrientation.lock(orientation);
    gameOrientationLockOwned = true;
    return true;
  } catch (error) {
    console.warn(`Could not lock game orientation to ${orientation}`, error);
    return false;
  }
}

export function prepareGameOrientation(
  orientation: GameManifestOrientation | undefined,
): Promise<boolean> {
  if (
    !preferredOrientation(orientation) ||
    !supportsMobileOrientationLock()
  ) {
    return Promise.resolve(false);
  }
  if (pendingGameOrientation) return pendingGameOrientation;
  const attempt = (async () => {
    if (!document.fullscreenElement) {
      const requestFullscreen = document.documentElement.requestFullscreen;
      if (requestFullscreen) {
        try {
          await requestFullscreen.call(document.documentElement);
          gameFullscreenOwned =
            document.fullscreenElement === document.documentElement;
        } catch (error) {
          // Installed applications may permit orientation locking without the
          // Fullscreen API, so still try the lock before falling back to the
          // platform prompt.
          console.warn(
            "Could not enter fullscreen for game orientation",
            error,
          );
        }
      }
    }
    return lockGameOrientation(orientation);
  })();
  const pending = attempt.finally(() => {
    if (pendingGameOrientation === pending) {
      pendingGameOrientation = undefined;
    }
  });
  pendingGameOrientation = pending;
  return pending;
}

export async function releaseGameFullscreen(): Promise<void> {
  if (gameOrientationLockOwned) {
    gameOrientationLockOwned = false;
    lockableOrientation()?.unlock();
  }
  if (
    !gameFullscreenOwned ||
    document.fullscreenElement !== document.documentElement
  ) {
    gameFullscreenOwned = false;
    return;
  }
  gameFullscreenOwned = false;
  try {
    await document.exitFullscreen();
  } catch (error) {
    console.warn("Could not exit game fullscreen", error);
  }
}

export function useGameViewport(
  active: boolean,
  preferences?: GameViewportPreferences,
): GameViewportController {
  const [orientationAction, setOrientationAction] = useState<
    "enter" | "restore"
  >();
  const orientationEffectGeneration = useRef(0);
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
    const backgroundValue =
      preferences?.backgroundColor ?? DEFAULT_GAME_BACKGROUND_COLOR;
    const themeValue = preferences?.themeColor ?? DEFAULT_GAME_THEME_COLOR;
    const renderedBackground = renderedColor(backgroundValue, WHITE);
    const renderedTheme = renderedColor(themeValue, renderedBackground);
    root.style.setProperty(
      "--game-foreground-color",
      contrastingTextColor(renderedBackground),
    );
    root.style.setProperty(
      "--game-on-theme-color",
      contrastingTextColor(renderedTheme),
    );
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
      root.style.removeProperty("--game-foreground-color");
      root.style.removeProperty("--game-theme-color");
      root.style.removeProperty("--game-on-theme-color");
      if (themeMeta) {
        if (previousThemeColor === null) themeMeta.removeAttribute("content");
        else themeMeta.setAttribute("content", previousThemeColor);
      }
    };
  }, [active, preferences?.backgroundColor, preferences?.themeColor]);

  const enterPreferredOrientation = useCallback(async () => {
    const preference = preferences?.orientation;
    if (!preferredOrientation(preference)) {
      setOrientationAction(undefined);
      return;
    }
    await prepareGameOrientation(preference);
    setOrientationAction(undefined);
  }, [preferences?.orientation]);

  useEffect(() => {
    const preference = preferences?.orientation;
    setOrientationAction(undefined);
    if (
      !active ||
      !preferredOrientation(preference) ||
      !supportsMobileOrientationLock()
    ) {
      return;
    }
    const generation = ++orientationEffectGeneration.current;
    const orientation = lockableOrientation();
    if (!orientation?.lock) return;
    let effectActive = true;
    let hasEnteredGame = false;

    const restoreOrientation = async (action: "enter" | "restore") => {
      if (!effectActive || document.visibilityState !== "visible") return;
      const pendingAttempt = pendingGameOrientation;
      const locked = pendingAttempt
        ? await pendingAttempt
        : await lockGameOrientation(preference);
      if (!effectActive) return;
      hasEnteredGame = true;
      setOrientationAction(locked ? undefined : action);
    };

    const onFullscreenChange = () => {
      if (document.fullscreenElement === document.documentElement) return;
      gameFullscreenOwned = false;
      gameOrientationLockOwned = false;
      if (document.visibilityState === "visible" && hasEnteredGame) {
        setOrientationAction("restore");
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void restoreOrientation(hasEnteredGame ? "restore" : "enter");
      }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void restoreOrientation("enter");

    return () => {
      effectActive = false;
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const retirementGeneration = ++orientationEffectGeneration.current;
      const pendingAttempt = pendingGameOrientation;
      void (pendingAttempt ?? Promise.resolve()).then(() => {
        // React may immediately restart an effect in development or while the
        // preference changes. Only the latest retired session may tear down
        // fullscreen; a replacement session keeps using it.
        if (
          orientationEffectGeneration.current === retirementGeneration &&
          generation < retirementGeneration
        ) {
          void releaseGameFullscreen();
        }
      });
    };
  }, [active, preferences?.orientation]);

  return { orientationAction, enterPreferredOrientation };
}

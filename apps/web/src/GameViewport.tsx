import {
  ExternalLink,
  Maximize2,
  MoreHorizontal,
  Smartphone,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "./i18n";
import type { LandscapeCompatibilityRotation } from "./use-game-viewport";

export default function GameViewport({
  children,
  infoExpanded,
  onOpenInfo,
  orientationAction,
  onEnterPreferredOrientation,
  onEnableLandscapeCompatibility,
  landscapeCompatibilityRotation,
  showOptions = true,
}: {
  children: ReactNode;
  infoExpanded: boolean;
  onOpenInfo(): void;
  orientationAction?: "enter" | "restore" | "unsupported";
  onEnterPreferredOrientation?(): void;
  onEnableLandscapeCompatibility?(): void;
  landscapeCompatibilityRotation?: LandscapeCompatibilityRotation;
  showOptions?: boolean;
}) {
  const { t } = useI18n();
  const stageStyle = landscapeCompatibilityRotation
    ? ({
        "--game-viewport-rotation": landscapeCompatibilityRotation,
      } as CSSProperties)
    : undefined;

  return (
    <>
      <div
        className={`game-viewport-stage${landscapeCompatibilityRotation ? " game-viewport-stage-landscape-compatibility" : ""}`}
        style={stageStyle}
      >
        {children}
        {showOptions && (
          <button
            className="platform-menu-button"
            type="button"
            aria-label={t("gameInformation")}
            aria-expanded={infoExpanded}
            onClick={onOpenInfo}
          >
            <MoreHorizontal aria-hidden="true" size={24} />
          </button>
        )}
      </div>
      {orientationAction === "unsupported" ? (
        <div
          className="game-orientation-gate game-orientation-unsupported"
          role="alert"
        >
          <div className="game-orientation-unsupported-content">
            <ExternalLink aria-hidden="true" />
            <strong>{t("openInAnotherBrowser")}</strong>
            {onEnableLandscapeCompatibility && (
              <button
                className="game-orientation-enter"
                type="button"
                onClick={onEnableLandscapeCompatibility}
              >
                <Smartphone className="landscape-mode-icon" aria-hidden="true" />
                <span>{t("continueInLandscapeMode")}</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        orientationAction &&
        onEnterPreferredOrientation && (
          <div className="game-orientation-gate">
            <button
              className="game-orientation-enter"
              type="button"
              onClick={onEnterPreferredOrientation}
            >
              <Maximize2 aria-hidden="true" />
              <span>
                {t(
                  orientationAction === "restore"
                    ? "restoreLandscapeGame"
                    : "enterFullscreenGame",
                )}
              </span>
            </button>
          </div>
        )
      )}
    </>
  );
}

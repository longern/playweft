import { ExternalLink, Maximize2, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "./i18n";

export default function GameViewport({
  children,
  infoExpanded,
  onOpenInfo,
  orientationAction,
  onEnterPreferredOrientation,
  showOptions = true,
}: {
  children: ReactNode;
  infoExpanded: boolean;
  onOpenInfo(): void;
  orientationAction?: "enter" | "restore" | "unsupported";
  onEnterPreferredOrientation?(): void;
  showOptions?: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      {children}
      {orientationAction === "unsupported" ? (
        <div
          className="game-orientation-gate game-orientation-unsupported"
          role="alert"
        >
          <div className="game-orientation-unsupported-content">
            <ExternalLink aria-hidden="true" />
            <strong>{t("openInAnotherBrowser")}</strong>
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
    </>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, CircleHelp, Link2, RefreshCw, Star, X } from "lucide-react";
import { useI18n } from "./i18n";
import { gameLaunchLink } from "./game-launch-link";

export interface GameInfoAction {
  label: string;
  variant?: "primary" | "secondary";
  onSelect(): void;
}

interface GameInfoPanelProps {
  actions?: GameInfoAction[];
  description?: string;
  icon?: string;
  isFavorite?: boolean;
  manifestUrl?: string;
  name: string;
  url: string;
  onClose(): void;
  onRefresh?(): void;
  onShowHelp?(): void;
  onToggleFavorite?(): void;
}

export default function GameInfoPanel({
  actions,
  description,
  icon,
  isFavorite,
  manifestUrl,
  name,
  url,
  onClose,
  onRefresh,
  onShowHelp,
  onToggleFavorite,
}: GameInfoPanelProps) {
  const { t } = useI18n();
  const [closing, setClosing] = useState(false);
  const [gameLinkCopied, setGameLinkCopied] = useState(false);
  const [urlTooltipVisible, setUrlTooltipVisible] = useState(false);
  const afterClose = useRef<(() => void) | undefined>(undefined);
  const copyResetTimer = useRef<number | undefined>(undefined);
  const dialog = useRef<HTMLDialogElement>(null);
  let gameSourceHost = url;
  try {
    gameSourceHost = new URL(url).host;
  } catch {
    // Keep the original value if a caller supplies a non-URL label.
  }

  const close = (after?: () => void) => {
    afterClose.current = after;
    setClosing(true);
  };

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    if (!closing) return;
    const finish = () => {
      onClose();
      afterClose.current?.();
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const timeout = window.setTimeout(finish, 180);
    return () => window.clearTimeout(timeout);
  }, [closing, onClose]);

  useEffect(
    () => () => {
      if (copyResetTimer.current !== undefined) {
        window.clearTimeout(copyResetTimer.current);
      }
    },
    [],
  );

  const copyGameLink = async () => {
    if (!manifestUrl) return;
    try {
      await navigator.clipboard.writeText(gameLaunchLink(manifestUrl));
      setGameLinkCopied(true);
      if (copyResetTimer.current !== undefined) {
        window.clearTimeout(copyResetTimer.current);
      }
      copyResetTimer.current = window.setTimeout(
        () => setGameLinkCopied(false),
        1_500,
      );
    } catch {
      setGameLinkCopied(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className="game-info-layer"
      aria-labelledby="game-info-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <button
        className={`game-info-backdrop ${closing ? "game-info-backdrop-closing" : ""}`}
        type="button"
        tabIndex={-1}
        aria-label={t("closeGameInformation")}
        onClick={() => close()}
      />
      <section
        className={`game-info-panel ${closing ? "game-info-panel-closing" : ""}`}
      >
        <header className="game-info-header">
          <h2 id="game-info-title">{t("gameInformation")}</h2>
          <button
            type="button"
            aria-label={t("closeGameInformation")}
            onClick={() => close()}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="game-info-content">
          <div className="game-info-icon" aria-hidden="true">
            {icon ? (
              <img
                src={icon}
                width="64"
                height="64"
                alt=""
                referrerPolicy="no-referrer"
              />
            ) : (
              <span>{name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="game-info-copy">
            <h3>{name}</h3>
            <button
              className="game-info-url"
              type="button"
              aria-expanded={urlTooltipVisible}
              aria-describedby="game-info-url-tooltip"
              onBlur={() => setUrlTooltipVisible(false)}
              onClick={() => setUrlTooltipVisible((visible) => !visible)}
            >
              <span className="game-info-url-text">{gameSourceHost}</span>
              <span
                id="game-info-url-tooltip"
                className="game-info-url-tooltip"
                role="tooltip"
              >
                <span className="game-info-url-tooltip-label">
                  {t("gameSource")}
                </span>
                <span className="game-info-url-tooltip-value">{url}</span>
              </span>
            </button>
          </div>
        </div>
        {description && <p className="game-info-description">{description}</p>}
        {(onRefresh || onShowHelp || onToggleFavorite) && (
          <>
            <hr className="game-info-quick-actions-divider" />
            <div className="game-info-quick-actions">
              {onToggleFavorite && (
                <button
                  type="button"
                  aria-pressed={isFavorite}
                  onClick={onToggleFavorite}
                >
                  <span className="game-info-quick-action-icon">
                    <Star
                      aria-hidden="true"
                      fill={isFavorite ? "currentColor" : "none"}
                    />
                  </span>
                  <span className="game-info-quick-action-label">
                    {t(isFavorite ? "unfavorite" : "favorite")}
                  </span>
                </button>
              )}
              {onRefresh && (
                <button type="button" onClick={() => close(onRefresh)}>
                  <span className="game-info-quick-action-icon">
                    <RefreshCw aria-hidden="true" />
                  </span>
                  <span className="game-info-quick-action-label">
                    {t("refresh")}
                  </span>
                </button>
              )}
              {manifestUrl && (
                <button type="button" onClick={() => void copyGameLink()}>
                  <span
                    className={`game-info-quick-action-icon ${gameLinkCopied ? "game-info-quick-action-icon-success" : ""}`}
                  >
                    {gameLinkCopied ? (
                      <Check aria-hidden="true" />
                    ) : (
                      <Link2 aria-hidden="true" />
                    )}
                  </span>
                  <span
                    className="game-info-quick-action-label"
                    aria-live="polite"
                  >
                    {t(gameLinkCopied ? "gameLinkCopied" : "copyGameLink")}
                  </span>
                </button>
              )}
              {onShowHelp && (
                <button type="button" onClick={() => close(onShowHelp)}>
                  <span className="game-info-quick-action-icon">
                    <CircleHelp aria-hidden="true" />
                  </span>
                  <span className="game-info-quick-action-label">
                    {t("help")}
                  </span>
                </button>
              )}
            </div>
          </>
        )}
        {actions && actions.length > 0 && (
          <footer className="game-info-actions">
            {actions.map((action) => (
              <button
                key={action.label}
                className={`game-info-action game-info-action-${action.variant ?? "secondary"}`}
                type="button"
                onClick={() => close(action.onSelect)}
              >
                {action.label}
              </button>
            ))}
          </footer>
        )}
      </section>
    </dialog>
  );
}

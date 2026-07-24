import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "./i18n";

export interface GameInfoAction {
  label: string;
  variant?: "primary" | "secondary";
  onSelect(): void;
}

interface GameInfoPanelProps {
  actions?: GameInfoAction[];
  icon?: string;
  name: string;
  url: string;
  onClose(): void;
}

export default function GameInfoPanel({
  actions,
  icon,
  name,
  url,
  onClose,
}: GameInfoPanelProps) {
  const { t } = useI18n();
  const [closing, setClosing] = useState(false);
  const afterClose = useRef<(() => void) | undefined>(undefined);

  const close = (after?: () => void) => {
    afterClose.current = after;
    setClosing(true);
  };

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

  return (
    <div className="game-info-layer" role="presentation">
      <button
        className={`game-info-backdrop ${closing ? "game-info-backdrop-closing" : ""}`}
        type="button"
        aria-label={t("closeGameInformation")}
        onClick={() => close()}
      />
      <section
        className={`game-info-panel ${closing ? "game-info-panel-closing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-info-title"
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
              <img src={icon} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span>{name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="game-info-copy">
            <h3>{name}</h3>
          </div>
        </div>
        <div className="game-info-url">
          {url}
        </div>
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
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

export interface DialogAction {
  label: string;
  variant?: "primary" | "danger";
  onSelect?(): void;
}

interface DialogProps {
  title: string;
  children: ReactNode;
  onDismiss(): void;
  actions?: DialogAction[];
  size?: "default" | "wide" | "large";
}

export default function Dialog({
  title,
  children,
  onDismiss,
  actions,
  size = "default",
}: DialogProps) {
  const [closing, setClosing] = useState(false);
  const afterClose = useRef<(() => void) | undefined>(undefined);

  const close = (after?: () => void) => {
    afterClose.current = after;
    setClosing(true);
  };

  useEffect(() => {
    if (!closing) return;
    const finish = () => {
      onDismiss();
      afterClose.current?.();
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    const timeout = window.setTimeout(finish, 180);
    return () => window.clearTimeout(timeout);
  }, [closing, onDismiss]);

  return (
    <div
      className={`dialog-layer ${closing ? "dialog-closing" : ""}`}
      role="presentation"
    >
      <button
        className="dialog-backdrop"
        type="button"
        aria-label={`Close ${title} dialog`}
        onClick={() => close()}
      />
      <section
        className={`dialog dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <header className="dialog-header">
          <h2 id="dialog-title">{title}</h2>
          <button
            type="button"
            onClick={() => close()}
            aria-label={`Close ${title} dialog`}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="dialog-content">{children}</div>
        {actions && (
          <footer className="dialog-actions">
            {actions.map((action) => (
              <button
                key={action.label}
                className={`dialog-action${action.variant ? ` dialog-action-${action.variant}` : ""}`}
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

import { useEffect, useState } from "react";

interface ErrorToastProps {
  message: string;
  onDismiss(): void;
}

export default function ErrorToast({ message, onDismiss }: ErrorToastProps) {
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    setClosing(false);
  }, [message]);

  useEffect(() => {
    if (!closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDismiss();
      return;
    }
    const timeout = window.setTimeout(onDismiss, 250);
    return () => window.clearTimeout(timeout);
  }, [closing, onDismiss]);

  return <div className={`error-toast ${closing ? "error-toast-closing" : ""}`} role="alert" aria-live="assertive">
    <span className="error-toast-icon" aria-hidden="true">!</span>
    <p>{message}</p>
    <button type="button" onClick={() => setClosing(true)} aria-label="Dismiss error">×</button>
  </div>;
}

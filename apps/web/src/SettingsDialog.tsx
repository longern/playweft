import { ArrowLeft } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  applyAppLoadPolicy,
  readAppLoadPolicy,
  type AppLoadPolicy,
} from "./app-load-policy";
import { useI18n } from "./i18n";

export default function SettingsDialog({ onBack }: { onBack(): void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const [loadPolicy, setLoadPolicy] = useState(readAppLoadPolicy);
  const [applyingPolicy, setApplyingPolicy] = useState(false);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onBack();
  };

  const close = () => {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finish();
      return;
    }
    setClosing(true);
  };

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  const updateLoadPolicy = (nextPolicy: AppLoadPolicy) => {
    if (nextPolicy === loadPolicy || applyingPolicy) return;
    setLoadPolicy(nextPolicy);
    setApplyingPolicy(true);
    void applyAppLoadPolicy(nextPolicy).finally(() => setApplyingPolicy(false));
  };

  return (
    <dialog
      ref={dialog}
      className={`settings-dialog-layer${closing ? " settings-dialog-closing" : ""}`}
      aria-labelledby="settings-dialog-title"
      onAnimationEnd={(event) => {
        if (
          !closing ||
          event.target !== event.currentTarget ||
          event.animationName !== "settings-dialog-out"
        ) {
          return;
        }
        finish();
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="settings-dialog-header">
        <button
          className="settings-dialog-back"
          type="button"
          aria-label={t("back")}
          autoFocus
          onClick={close}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <h2 id="settings-dialog-title">{t("settings")}</h2>
      </header>
      <main className="settings-dialog-scroll">
        <div className="settings-dialog-content">
          <section className="settings-card" aria-label={t("appLoadingMode")}>
            <label className="settings-list-item">
              <span>{t("appLoadingMode")}</span>
              <select
                aria-label={t("appLoadingMode")}
                disabled={applyingPolicy}
                value={loadPolicy}
                onChange={(event) =>
                  updateLoadPolicy(event.target.value as AppLoadPolicy)
                }
              >
                <option value="cache-disabled">{t("cacheDisabled")}</option>
                <option value="network-first">{t("networkFirst")}</option>
                <option value="update-prompt">{t("updatePrompt")}</option>
                <option value="local-only">{t("localOnly")}</option>
              </select>
            </label>
          </section>
        </div>
      </main>
    </dialog>
  );
}

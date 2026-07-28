import { useCallback, useEffect, useRef, useState } from "react";
import { JsonRpcErrorCode } from "@playweft/game-protocol";
import { RpcFault } from "./json-rpc";
import { useI18n } from "./i18n";

const CLIPBOARD_GRANTS_KEY = "playweft:clipboard-read-grants:v1";
const MAX_CLIPBOARD_BYTES = 64 * 1024;
const PROMPT_TIMEOUT_MS = 30_000;
const NOTICE_DURATION_MS = 1_800;
const MIN_READ_INTERVAL_MS = 1_000;

interface PromptState {
  gameName: string;
  origin: string;
  reason?: string;
  reading: boolean;
}

interface PendingRead {
  resolve(value: string): void;
  reject(reason: RpcFault): void;
  timeout: number;
}

export function useClipboardRead(gameName: string, gameOrigin: string | undefined) {
  const { t } = useI18n();
  const identityRef = useRef({ gameName, gameOrigin });
  identityRef.current = { gameName, gameOrigin };
  const translatorRef = useRef(t);
  translatorRef.current = t;
  const pendingRef = useRef<PendingRead | undefined>(undefined);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const lastReadAtRef = useRef(0);
  const [prompt, setPrompt] = useState<PromptState>();
  const [notice, setNotice] = useState<string>();

  const clearNotice = useCallback(() => {
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = undefined;
    setNotice(undefined);
  }, []);

  const showNotice = useCallback((message: string) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = undefined;
      setNotice(undefined);
    }, NOTICE_DURATION_MS);
  }, []);

  const finish = useCallback((outcome: { text: string } | { error: RpcFault }) => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = undefined;
    window.clearTimeout(pending.timeout);
    setPrompt(undefined);
    if ("text" in outcome) pending.resolve(outcome.text);
    else pending.reject(outcome.error);
  }, []);

  const readClipboard = useCallback(async () => {
    const identity = identityRef.current;
    showNotice(
      translatorRef.current("clipboardReadNotice", {
        name: identity.gameName,
      }),
    );
    setPrompt((current) => current ? { ...current, reading: true } : current);
    try {
      if (!navigator.clipboard?.readText) {
        throw clipboardFault(
          "NOT_SUPPORTED",
          "Clipboard reading is not supported by this browser",
        );
      }
      const text = await navigator.clipboard.readText();
      if (new TextEncoder().encode(text).byteLength > MAX_CLIPBOARD_BYTES) {
        throw clipboardFault(
          "TOO_LARGE",
          `Clipboard text exceeds the ${MAX_CLIPBOARD_BYTES}-byte limit`,
        );
      }
      if (identity.gameOrigin) rememberGrant(identity.gameOrigin);
      finish({ text });
    } catch (reason) {
      clearNotice();
      finish({
        error:
          reason instanceof RpcFault
            ? reason
            : clipboardFault(
                reason instanceof DOMException && reason.name === "NotAllowedError"
                  ? "NOT_ALLOWED"
                  : "READ_FAILED",
                reason instanceof Error
                  ? reason.message
                  : "Could not read the clipboard",
                true,
              ),
      });
    }
  }, [clearNotice, finish, showNotice]);

  const requestReadText = useCallback((reason?: string): Promise<string> => {
    if (pendingRef.current) {
      return Promise.reject(
        clipboardFault("BUSY", "Another clipboard request is pending", true),
      );
    }
    const retryAfterMs =
      MIN_READ_INTERVAL_MS - (Date.now() - lastReadAtRef.current);
    if (retryAfterMs > 0) {
      return Promise.reject(
        new RpcFault(
          JsonRpcErrorCode.PlatformError,
          "Clipboard reads are rate limited",
          {
            code: "RATE_LIMITED",
            retryable: true,
            retryAfterMs,
          },
        ),
      );
    }
    lastReadAtRef.current = Date.now();
    const { gameName: currentName, gameOrigin: currentOrigin } =
      identityRef.current;
    if (!currentOrigin) {
      return Promise.reject(
        clipboardFault("NOT_ALLOWED", "The game origin is unavailable"),
      );
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        finish({
          error: clipboardFault(
            "REQUEST_EXPIRED",
            "Clipboard request expired",
            true,
          ),
        });
      }, PROMPT_TIMEOUT_MS);
      pendingRef.current = { resolve, reject, timeout };
      if (hasGrant(currentOrigin)) {
        void readClipboard();
        return;
      }
      setPrompt({
        gameName: currentName,
        origin: currentOrigin,
        ...(reason ? { reason } : {}),
        reading: false,
      });
    });
  }, [finish, readClipboard, showNotice]);

  const deny = useCallback(() => {
    finish({
      error: clipboardFault("USER_DENIED", "Clipboard access was denied"),
    });
  }, [finish]);

  const cancelPending = useCallback(() => {
    finish({
      error: clipboardFault(
        "REQUEST_CANCELLED",
        "Clipboard request was cancelled",
        true,
      ),
    });
  }, [finish]);

  useEffect(
    () => () => {
      window.clearTimeout(noticeTimerRef.current);
      const pending = pendingRef.current;
      if (!pending) return;
      window.clearTimeout(pending.timeout);
      pending.reject(
        clipboardFault(
          "REQUEST_CANCELLED",
          "Clipboard request was cancelled",
          true,
        ),
      );
      pendingRef.current = undefined;
    },
    [],
  );

  return {
    requestReadText,
    cancelPending,
    prompt,
    notice,
    allow: readClipboard,
    deny,
    clearNotice,
  };
}

export function ClipboardPrompt({
  prompt,
  notice,
  onAllow,
  onDeny,
  onDismissNotice,
}: {
  prompt?: PromptState;
  notice?: string;
  onAllow(): void;
  onDeny(): void;
  onDismissNotice(): void;
}) {
  const { t } = useI18n();
  if (!prompt && !notice) return null;

  if (!prompt) {
    return (
      <div className="clipboard-notice" role="status" aria-live="polite">
        <span>{notice}</span>
        <button
          type="button"
          onClick={onDismissNotice}
          aria-label={t("dismissClipboardNotice")}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <section
      className="clipboard-prompt"
      role="alertdialog"
      aria-labelledby="clipboard-prompt-title"
      aria-describedby={prompt.reason ? "clipboard-prompt-reason" : undefined}
    >
      <div>
        <strong id="clipboard-prompt-title">
          {t("clipboardReadRequest", { name: prompt.gameName })}
        </strong>
        <span>{prompt.origin}</span>
        {prompt.reason && (
          <p id="clipboard-prompt-reason">{prompt.reason}</p>
        )}
        <small>{t("clipboardGrantRemembered")}</small>
      </div>
      <div className="clipboard-prompt-actions">
        <button
          type="button"
          autoFocus
          disabled={prompt.reading}
          onClick={onDeny}
        >
          {t("deny")}
        </button>
        <button
          className="primary"
          type="button"
          disabled={prompt.reading}
          onClick={onAllow}
        >
          {prompt.reading ? t("readingClipboard") : t("allowOnce")}
        </button>
      </div>
    </section>
  );
}

function clipboardFault(
  code: string,
  message: string,
  retryable = false,
): RpcFault {
  return new RpcFault(JsonRpcErrorCode.PlatformError, message, {
    code,
    retryable,
  });
}

function hasGrant(origin: string): boolean {
  return readGrants().includes(origin);
}

function rememberGrant(origin: string): void {
  const grants = new Set(readGrants());
  grants.add(origin);
  try {
    localStorage.setItem(
      CLIPBOARD_GRANTS_KEY,
      JSON.stringify([...grants].slice(-128)),
    );
  } catch {
    // The browser may disable local storage. The current read still succeeds.
  }
}

function readGrants(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(CLIPBOARD_GRANTS_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

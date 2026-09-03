import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  enforceAppLoadPolicy,
  readAppLoadPolicy,
  subscribeToAppLoadPolicy,
  type AppLoadPolicy,
} from "./app-load-policy";

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1_000;

export function usePwaUpdate() {
  const [loadPolicy, setLoadPolicy] = useState<AppLoadPolicy>(
    readAppLoadPolicy,
  );
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration>();
  const [updating, setUpdating] = useState(false);
  const lastUpdateCheck = useRef(0);
  const reloadRequested = useRef(false);
  const {
    needRefresh: [updateAvailable, setUpdateAvailable],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onNeedReload() {
      if (reloadRequested.current) window.location.reload();
    },
    onRegisteredSW(_scriptUrl, nextRegistration) {
      setRegistration(nextRegistration);
    },
    onRegisterError(error) {
      console.error("Could not register the Playweft service worker", error);
    },
  });

  useEffect(() => subscribeToAppLoadPolicy(() => setLoadPolicy(readAppLoadPolicy)), []);

  useEffect(() => {
    if (loadPolicy !== "cache-disabled" || !registration) return;
    void enforceAppLoadPolicy(loadPolicy);
  }, [loadPolicy, registration]);

  useEffect(() => {
    if (loadPolicy !== "update-prompt") setUpdateAvailable(false);
  }, [loadPolicy, setUpdateAvailable]);

  const checkForUpdate = useCallback(
    (force = false) => {
      if (
        loadPolicy !== "update-prompt" ||
        !registration ||
        !navigator.onLine
      ) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastUpdateCheck.current < UPDATE_CHECK_INTERVAL_MS)
        return;
      lastUpdateCheck.current = now;
      void registration.update().catch(() => {
        // Keep the cached version running when the update check cannot connect.
      });
    },
    [loadPolicy, registration],
  );

  useEffect(() => {
    if (!registration) return;
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };
    const checkWhenOnline = () => checkForUpdate(true);
    const interval = window.setInterval(
      checkForUpdate,
      UPDATE_CHECK_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("online", checkWhenOnline);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("online", checkWhenOnline);
    };
  }, [checkForUpdate, registration]);

  const applyUpdate = useCallback(async () => {
    if (updating) return;
    reloadRequested.current = true;
    setUpdating(true);
    try {
      await updateServiceWorker();
    } catch (error) {
      reloadRequested.current = false;
      setUpdating(false);
      console.error("Could not activate the Playweft update", error);
    }
  }, [updateServiceWorker, updating]);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
  }, [setUpdateAvailable]);

  return {
    applyUpdate,
    dismissUpdate,
    loadPolicy,
    updateAvailable,
    updating,
  };
}

/**
 * Offline fallback page logic. Shown when the SaaS URL can't be reached.
 * Offers a retry (reload the app) and reacts to connectivity changes pushed
 * from the main process.
 */
(() => {
  const retryBtn = document.getElementById("retry") as HTMLButtonElement | null;
  const statusEl = document.getElementById("status");

  function setStatus(text: string): void {
    if (statusEl) statusEl.textContent = text;
  }

  retryBtn?.addEventListener("click", () => {
    setStatus("Reconnecting…");
    void window.dealflow.reloadApp();
  });

  // Auto-retry when connectivity returns.
  window.dealflow.onConnectivityChanged((s) => {
    if (s.online) {
      setStatus("Back online — reconnecting…");
      void window.dealflow.reloadApp();
    } else {
      setStatus("Still offline. We'll reconnect automatically.");
    }
  });

  window.dealflow.rendererReady();
})();

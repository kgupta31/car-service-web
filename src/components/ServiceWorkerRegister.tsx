"use client";

import { useEffect } from "react";

// Registers public/sw.js — required for TWA installability, not for offline
// support (see the comment in sw.js). Silently no-ops on failure or in
// browsers without serviceWorker support; this is purely additive and must
// never be able to break the page it's mounted on.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Best-effort — the site works identically with or without it.
      });
    }
  }, []);

  return null;
}

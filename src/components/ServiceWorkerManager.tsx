"use client";

import { useEffect } from "react";

export function ServiceWorkerManager() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      // Unregister old firebase-messaging-sw.js to prevent duplicate notifications
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          if (registration.active?.scriptURL.includes('firebase-messaging-sw.js')) {
            console.log("Unregistering old firebase-messaging-sw.js");
            registration.unregister();
          }
        }
      });
    }
  }, []);

  return null;
}

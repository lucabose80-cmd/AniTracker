"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";

export function ServiceWorkerManager() {
  const setIsOnline = useAppStore(state => state.setIsOnline);
  const clearOfflineQueue = useAppStore(state => state.clearOfflineQueue);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Unregister old firebase-messaging-sw.js
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          if (registration.active?.scriptURL.includes('firebase-messaging-sw.js')) {
            console.log("Unregistering old firebase-messaging-sw.js");
            registration.unregister();
          }
        }
      });
    }

    // Online/Offline Detection
    const handleOnline = () => {
      setIsOnline(true);
      clearOfflineQueue();
      console.log('[WeebCheck] Back online - Firestore will auto-sync queued writes');
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      console.log('[WeebCheck] Gone offline - writes will be queued locally');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setIsOnline, clearOfflineQueue]);

  return null;
}

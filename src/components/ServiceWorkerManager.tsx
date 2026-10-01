"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { fetchAniList, GET_TRENDING_WORKS } from "@/lib/anilist";

export function ServiceWorkerManager() {
  const setIsOnline = useAppStore(state => state.setIsOnline);
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Unregister old firebase-messaging-sw.js and precache covers
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready.then(() => {
        fetchAniList(GET_TRENDING_WORKS, { type: 'ANIME', page: 1, perPage: 10 })
          .then((data: any) => {
            const covers = data?.Page?.media?.map((m: any) => m.coverImage?.extraLarge || m.coverImage?.large) || [];
            covers.forEach((url: string) => {
              if (url) fetch(url, { mode: 'no-cors' }).catch(() => {});
            });
          })
          .catch((err: any) => console.error("[WeebCheck] Failed to pre-cache covers:", err));
      });

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
      console.log('[WeebCheck] Back online');
    };
    
    const handleOffline = () => {
      setIsOnline(false);
      console.log('[WeebCheck] Gone offline - writes will be queued locally');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);
    if (navigator.onLine) {
      clearOfflineQueue();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setIsOnline, clearOfflineQueue]);

  return null;
}

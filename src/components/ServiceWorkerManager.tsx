"use client";

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { fetchAniList, GET_TRENDING_WORKS } from "@/lib/anilist";
import { auth, db } from "@/lib/firebase";

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

    // Build Change Detection: Compare stored SHA with current build SHA
    if (typeof window !== 'undefined') {
      const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA;
      if (BUILD_SHA) {
        const storedSha = localStorage.getItem('anitracker_build_sha');
        if (storedSha && storedSha !== BUILD_SHA) {
          // New build detected - add in-app notification to Firestore for this user
          const user = auth.currentUser;
          if (user && db) {
            import('@/lib/firebase').then(({ db }) => {
              import('firebase/firestore').then(({ collection, doc, setDoc }) => {
                const notifRef = doc(collection(db!, 'notifications'));
                setDoc(notifRef, {
                  notification_id: notifRef.id,
                  user_id: user.uid,
                  actor_id: 'SYSTEM',
                  actor_name: 'System Update',
                  actor_avatar: '/weebcheck-192x192.png',
                  type: 'APP_UPDATE',
                  text: 'Neues Update installiert! Die App wurde aktualisiert.',
                  timestamp: new Date().toISOString(),
                  read: false,
                }).catch(console.error);
              });
            });
          }
        }
        // Always update stored SHA
        localStorage.setItem('anitracker_build_sha', BUILD_SHA);
      }
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

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setIsOnline]);

  return null;
}

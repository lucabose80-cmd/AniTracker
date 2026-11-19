'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { auth, db } from '@/lib/firebase';
import { syncExistingPushToken, setupOnMessage } from '@/lib/fcm';

export function ServiceWorkerManager() {
  const setIsOnline = useAppStore(state => state.setIsOnline);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Register /sw.js and unregister legacy firebase-messaging-sw.js
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then(async (registrations) => {
          let hasMainSw = false;
          for (const registration of registrations) {
            if (registration.active?.scriptURL.includes('firebase-messaging-sw.js')) {
              await registration.unregister();
            } else if (registration.active?.scriptURL.includes('/sw.js')) {
              hasMainSw = true;
            }
          }
          if (!hasMainSw) {
            try {
              await navigator.serviceWorker.register('/sw.js', { scope: '/' });
            } catch (swErr) {
              console.warn('ServiceWorker registration failed:', swErr);
            }
          }
        })
        .catch(console.warn);
    }

    // Online/Offline Detection
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);

    // Foreground push handler (shows system notification if browser permission is granted while app is open)
    const unsubscribeForegroundFcm = setupOnMessage((payload) => {
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        payload?.notification
      ) {
        navigator.serviceWorker.ready
          .then((reg) => {
            const notifTag =
              payload.data?.tag ||
              `anipulse-fg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const notifIcon =
              payload.notification.icon ||
              payload.data?.icon ||
              '/anipulse-192x192.png';
            reg.showNotification(payload.notification.title || 'AniPulse', {
              body: payload.notification.body || '',
              icon: notifIcon,
              badge: '/anipulse-badge-96.png',
              tag: notifTag,
              renotify: true,
              requireInteraction: true,
              silent: false,
              vibrate: [200, 100, 200],
              data: payload.data,
            } as NotificationOptions);
          })
          .catch(() => {});
      }
    });

    // --- APP VERSION CHECK via Firestore ---
    let unsubscribeVersionListener: (() => void) | null = null;
    let unsubscribeAuth: (() => void) | null = null;

    const setupVersionCheck = async (user: any) => {
      if (!user || !db) return;
      if (unsubscribeVersionListener) return; // already set up

      const { doc, onSnapshot, collection, setDoc } = await import('firebase/firestore');

      const versionDocRef = doc(db, 'app_config', 'version');

      unsubscribeVersionListener = onSnapshot(versionDocRef, async (snap) => {
        if (!snap.exists()) return;

        const remoteVersion = snap.data()?.version;
        const storedVersion = localStorage.getItem('anitracker_seen_version');

        if (remoteVersion && remoteVersion !== storedVersion) {
          localStorage.setItem('anitracker_seen_version', remoteVersion);

          // Only show notification if user has seen a version before (not first load)
          if (storedVersion !== null) {
            const notifRef = doc(collection(db!, 'notifications'));
            await setDoc(notifRef, {
              notification_id: notifRef.id,
              user_id: user.uid,
              actor_id: 'SYSTEM',
              actor_name: `System Update (v${remoteVersion})`,
              actor_avatar: '/anipulse-192x192.png',
              type: 'APP_UPDATE',
              text: `Neu: v${remoteVersion} ist da! Klicke hier zum Aktualisieren.`,
              timestamp: new Date().toISOString(),
              read: false,
            }).catch(console.error);
          }
        }
      });
    };

    let unsubscribeNotifications: (() => void) | null = null;

    (async () => {
      const { onAuthStateChanged } = await import('firebase/auth');
      unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
        if (user) {
          setupVersionCheck(user);

          // Automatically refresh and sync FCM token for this device if permission is already granted
          syncExistingPushToken(user.uid).catch(console.warn);

          // Setup global unread notifications listener without requiring composite index
          const { collection, query, where, onSnapshot } = await import('firebase/firestore');
          const q = query(
            collection(db!, 'notifications'),
            where('user_id', '==', user.uid)
          );

          unsubscribeNotifications = onSnapshot(
            q,
            (snap) => {
              const unread = snap.docs.filter((d) => {
                const data = d.data();
                if (data?.deleted === true) {
                  return false;
                }
                if (data?.type === 'NEW_EPISODE_THREAD' || data?.type === 'COMMENT_ON_THREAD') {
                  return false;
                }
                return data?.read === false;
              }).length;
              useAppStore.getState().setUnreadNotifications(unread);
            },
            (err) => {
              console.error('Unread notifications listener error:', err);
            }
          );
        } else {
          useAppStore.getState().setUnreadNotifications(0);
          if (unsubscribeNotifications) {
            unsubscribeNotifications();
            unsubscribeNotifications = null;
          }
        }
      });
    })();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (unsubscribeForegroundFcm) unsubscribeForegroundFcm();
      if (unsubscribeVersionListener) unsubscribeVersionListener();
      if (unsubscribeNotifications) unsubscribeNotifications();
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, [setIsOnline]);

  return null;
}


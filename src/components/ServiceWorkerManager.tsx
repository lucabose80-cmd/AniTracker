'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';
import { auth, db } from '@/lib/firebase';
import { CURRENT_APP_VERSION } from '@/lib/version';

export function ServiceWorkerManager() {
  const setIsOnline = useAppStore(state => state.setIsOnline);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Unregister old firebase-messaging-sw.js
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) {
          if (registration.active?.scriptURL.includes('firebase-messaging-sw.js')) {
            registration.unregister();
          }
        }
      });
    }

    // Online/Offline Detection
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);

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
              actor_name: 'System Update',
              actor_avatar: '/weebcheck-192x192.png',
              type: 'APP_UPDATE',
              text: `Neues App-Update installiert! (v${remoteVersion}) Tippe hier um neu zu laden.`,
              timestamp: new Date().toISOString(),
              read: false,
            }).catch(console.error);
          }
        }
      });
    };
    
    (async () => {
      const { onAuthStateChanged } = await import('firebase/auth');
      unsubscribeAuth = onAuthStateChanged(auth, (user) => {
        if (user) {
          setupVersionCheck(user);
        }
      });
    })();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (unsubscribeVersionListener) unsubscribeVersionListener();
      if (unsubscribeAuth) unsubscribeAuth();
    };
  }, [setIsOnline]);

  return null;
}

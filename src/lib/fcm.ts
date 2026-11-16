import { getMessaging, getToken, deleteToken, onMessage } from "firebase/messaging";
import { app, db } from "./firebase";
import { doc, setDoc, arrayUnion } from "firebase/firestore";

// Hardcoded VAPID Key provided by user
const VAPID_KEY = "BBNHu2VQ73Ua2oZA4uKgHG3jm8vF3yAouKzfdiStItZU6R0R4nL74TWDDYp5hPNf7e9u6wv5gApyc3JZ_zN5DRw";

export const requestForToken = async (userId: string) => {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      const messaging = getMessaging(app);
      
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const registration = await navigator.serviceWorker.ready;
        const currentToken = await getToken(messaging, { 
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration 
        });
        if (currentToken) {
          // Save token to user profile
          if (db && userId) {
            const userRef = doc(db, "users", userId);
            await setDoc(userRef, {
              fcm_tokens: arrayUnion(currentToken)
            }, { merge: true });
          }
          return currentToken;
        } else {
          const msg = "No registration token available. Request permission to generate one.";
          console.error(msg);
          throw new Error(msg);
        }
      } else if (permission === "denied") {
        const msg = "Notification permission denied by user or browser.";
        console.error(msg);
        throw new Error(msg);
      } else {
        const msg = `Notification permission not granted (status: ${permission}).`;
        console.warn(msg);
        throw new Error(msg);
      }
    } catch (err: any) {
      console.error("An error occurred while retrieving FCM token:", err?.code || err?.message || err);
      throw err;
    }
  }
};

export const setupOnMessage = (callback: (payload: any) => void) => {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      const messaging = getMessaging(app);
      return onMessage(messaging, callback);
    } catch (e) {
      console.log("FCM messaging not supported or configured incorrectly", e);
    }
  }
  return () => {};
};

export const repairToken = async (userId: string) => {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      const messaging = getMessaging(app);
      // Clear Firebase token cache
      try { await deleteToken(messaging); } catch(e) { console.log("deleteToken err", e); }
      
      // Clear browser push subscription
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }
      
      // Get a fresh token
      return await requestForToken(userId);
    } catch (err: any) {
      console.error("Error repairing FCM token:", err?.code || err?.message || err);
      throw err;
    }
  }
};

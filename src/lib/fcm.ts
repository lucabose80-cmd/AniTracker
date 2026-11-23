import {
  getMessaging,
  getToken,
  deleteToken,
  onMessage,
  MessagePayload,
} from "firebase/messaging";
import { app, db } from "./firebase";
import { doc, setDoc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";

// Hardcoded VAPID Key provided by user
const VAPID_KEY =
  "BBNHu2VQ73Ua2oZA4uKgHG3jm8vF3yAouKzfdiStItZU6R0R4nL74TWDDYp5hPNf7e9u6wv5gApyc3JZ_zN5DRw";

export async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  let reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) {
    reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  }
  return await navigator.serviceWorker.ready;
}

export const requestForToken = async (userId: string): Promise<string | undefined> => {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      const messaging = getMessaging(app);

      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const registration = await ensureServiceWorkerRegistration();
        const currentToken = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration,
        });
        if (currentToken) {
          if (db && userId) {
            const userRef = doc(db, "users", userId);
            await setDoc(
              userRef,
              {
                uid: userId,
                fcm_tokens: arrayUnion(currentToken),
              },
              { merge: true }
            );
          }
          return currentToken;
        } else {
          const msg =
            "No registration token available. Request permission to generate one.";
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
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("An error occurred while retrieving FCM token:", errMsg);
      throw err;
    }
  }
  return undefined;
};

/**
 * Silently refreshes and saves the current browser/device's FCM token
 * if Notification.permission is already "granted".
 */
export const syncExistingPushToken = async (
  userId: string
): Promise<string | null> => {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return null;
  }
  try {
    const messaging = getMessaging(app);
    const registration = await ensureServiceWorkerRegistration();
    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (currentToken && db && userId) {
      const userRef = doc(db, "users", userId);
      await setDoc(
        userRef,
        {
          uid: userId,
          fcm_tokens: arrayUnion(currentToken),
        },
        { merge: true }
      );
      return currentToken;
    }
  } catch (err) {
    console.warn("Silent FCM token sync skipped:", err);
  }
  return null;
};

export const setupOnMessage = (callback: (payload: MessagePayload) => void) => {
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
      const reg = await ensureServiceWorkerRegistration();

      // Remove old stale token from Firestore before regenerating
      try {
        const oldToken = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: reg,
        });
        if (oldToken && db && userId) {
          await updateDoc(doc(db, "users", userId), {
            fcm_tokens: arrayRemove(oldToken),
          }).catch(() => {});
        }
      } catch {
        // ignore if no existing token
      }

      try {
        await deleteToken(messaging);
      } catch (e) {
        console.log("deleteToken err", e);
      }

      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }

      return await requestForToken(userId);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("Error repairing FCM token:", errMsg);
      throw err;
    }
  }
  return undefined;
};

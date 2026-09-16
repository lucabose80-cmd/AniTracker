import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app, db } from "./firebase";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";

// You will need to replace this with your actual VAPID key from Firebase Console
const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_KEY || "";

export const requestForToken = async (userId: string) => {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      const messaging = getMessaging(app);
      
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const currentToken = await getToken(messaging, { vapidKey: VAPID_KEY });
        if (currentToken) {
          // Save token to user profile
          if (db && userId) {
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, {
              fcm_tokens: arrayUnion(currentToken)
            });
          }
          return currentToken;
        } else {
          console.log("No registration token available. Request permission to generate one.");
        }
      } else {
        console.log("Notification permission not granted.");
      }
    } catch (err) {
      console.log("An error occurred while retrieving token. ", err);
    }
  }
};

export const onMessageListener = () =>
  new Promise((resolve) => {
    const messaging = getMessaging(app);
    onMessage(messaging, (payload) => {
      resolve(payload);
    });
  });

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD9J0wKxGWQGCx0jrjAiKa5rSM36iKu3gs",
  authDomain: "anitracker-e6364.firebaseapp.com",
  projectId: "anitracker-e6364",
  storageBucket: "anitracker-e6364.firebasestorage.app",
  messagingSenderId: "848563417624",
  appId: "1:848563417624:web:d66d901b2348af7b9c496d",
  measurementId: "G-FLJNZ6WY2G"
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

// Analytics can only be initialized on the client side
// export const analytics = typeof window !== "undefined" ? getAnalytics(app) : null;

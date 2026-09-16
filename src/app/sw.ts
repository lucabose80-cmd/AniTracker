import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// --- Firebase Push Notification Background Handler ---
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyD9J0wKxGWQGCx0jrjAiKa5rSM36iKu3gs",
  authDomain: "anitracker-e6364.firebaseapp.com",
  projectId: "anitracker-e6364",
  storageBucket: "anitracker-e6364.firebasestorage.app",
  messagingSenderId: "848563417624",
  appId: "1:848563417624:web:d66d901b2348af7b9c496d",
};

// @ts-ignore
firebase.initializeApp(firebaseConfig);
// @ts-ignore
const messaging = firebase.messaging();

// FCM handles background messages automatically when a "notification" payload is present.
// We configure icon and urgency directly in the backend (webpush config) to avoid duplicate notifications.

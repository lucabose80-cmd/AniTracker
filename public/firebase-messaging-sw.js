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

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/icon512_maskable.png', // Assuming we have a standard PWA icon here
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

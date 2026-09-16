import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

if (!getApps().length) {
  try {
    initializeApp({
      credential: cert({
        projectId: "anitracker-e6364",
        clientEmail: "firebase-adminsdk-fbsvc@anitracker-e6364.iam.gserviceaccount.com",
        // Format the key properly to preserve newlines
        privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCW2F7/0qlAQzBG\n7uK0HW814FTmciFklKkDaTv28GPgjhEsskqZaoLb/KqDgaNB4R29UrWG/ze9F8Dp\nJUC5an8QAwmPnLDAe+rafXYVxaEmrkHnwDOfl8cu7p+XCeLqiTGQFGdq7YZv3/8I\n1GJd5uJdLneEBTAGl/Wr8HhuzMhdHGY74PRocNSMd7ENI4TzzguvaB5U8QuIVKdM\nmcxupsgmKSMCL3+2rcGY/KqvIXIBnJ7iB2qp0YiHaBx3d/OsKrk8qHs0b4mh2w50\nUMeeJvvP6AVWz7CGV7VLBH4HudFq+ZDFPxbwehxmhxfm45Y5Z69Hk1obOhe2AbOP\nXAUMLe1RAgMBAAECggEAAhjAc8n64SY57l95Sld/JWqghXo8Q3aTRZVNsIJRghRZ\nceOJyMl/p4UC3fx0H2kckaZL2IQ1QzEohNkYJeege+GN7UeIV6mVR2uPY9C1G2l4\nSCtOUGNiwPDPSjE4jKni5Om6sQRbjjQo6meQ1TUti+3mmoC7tNjBgP4A/4nERnKG\nVPVKP4TvF37fkjsgSGouf8V5WlblOK7BuTfzNSGsHchqKCqLCPmADk/+p3fvSfIQ\nzLNVf7azQcHN1c/T7kLxIJw1TnC+RY0rgLTc6XpdDcHB3n0RQhLSerCE3be3k1sE\nemlNUpJJvT3fUA7U2QZOkoWPvyvyueCBPzzkz8NV4QKBgQDGGBDd2HTvVH6Y143R\nHeXbobB8N7oTQsIdMGCYwNW7YtHTWtmWNUpTRsaa71+zvygiFU2xa0G+7eHdG2Ob\nT6j5aohstiU7P3om+fTKtGnjiuOQaXe4tOz/nc7e6tnjq8STnKnGd0FPys0fJS0X\nHwJaPc8kaAkMrSAwyoykqfdEcQKBgQDC8IsgFUx3g51j2NwmKvah2TUha4jWa8Nu\nCCa+tnl1CZbyMFD0g2X8nBKOSvJXdEFyaibvaruQ6gEr/SI0nEQYOZcUDfhTmxwx\n5ckL8KtdDYO6QTIrqdbkHQZAo1djmcTRMo0iR5/QhEynVJ2QaMbta/LR/fX3x9h3\nKSsMYdIm4QKBgQDD0vKJe/tMxAhJ63xkJtwdXB9tDGHDvJDL7hDvsGEY1r155CuI\nk7Gf1S1r6AqBVAzGdKzTIKZjqiFHRFYZKIxv02J9pSn1AfEtKpdU8zhiGeCP19Lk\nIubOYiAouZ0ftaOkEJC8gxNrX52allOWsa7Pqp5k7PtVLqfN081o0iR/4QKBgDEU\nRrLJKftdE58z1hl176pH+Wx0mnsBnq5xNvAFGQcyZuKK75bgDilPUgypKeKCzodz\n2mGkyZxujeT5UkdUoIBI35SY/9Bs2OhnJfrvmPVQlb2q9Gqx0/ySoiRb+4CEEl1p\nEMd0qPPimzn1v8W/23WjG/tqqSa9Fe7KWqA/cJ2BAoGAUk6SoMorQrszR3Yvh8ef\nKKnl2lQz+9fMYyEqj8ASv1bNRt96O4iEIV0sJGaxtVmadVlqionq/3ad5Luv/9/T\nJkQadbZgcD2DzYzcExTuEHcntsn7G7PTcxPHG7RzwOKj7iyHpPFt7/zkVs7T2X6i\nH1Pf2eYRAHMdR3hXhbTpsd8=\n-----END PRIVATE KEY-----\n",
      }),
    });
  } catch (error) {
    console.error('Firebase Admin initialization error', error);
  }
}

const adminDb = getFirestore();
const adminMessaging = getMessaging();

export { adminDb, adminMessaging };

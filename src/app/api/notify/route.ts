import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { adminDb, adminMessaging } = await import("@/lib/firebase-admin");
    const { targetUserId, title, body, type, link, excludeUserId } = await req.json();

    if (!targetUserId || !title || !body || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const iconUrl = "https://anitracker-delta.vercel.app/anipulse-192x192.png";

    if (targetUserId === "ALL") {
      const usersSnap = await adminDb.collection("users").get();
      const tokenToUserIds = new Map<string, string[]>();
      const tokens: string[] = [];

      usersSnap.forEach((doc: any) => {
        if (excludeUserId && doc.id === excludeUserId) return;
        const userData = doc.data();
        const settings = userData?.notification_settings || {
          releases: true,
          likes: true,
          replies: true,
          social: true,
        };
        if (settings[type] !== false && Array.isArray(userData.fcm_tokens)) {
          userData.fcm_tokens.forEach((tk: string) => {
            if (!tk) return;
            if (!tokenToUserIds.has(tk)) {
              tokenToUserIds.set(tk, []);
              tokens.push(tk);
            }
            tokenToUserIds.get(tk)!.push(doc.id);
          });
        }
      });

      if (tokens.length === 0) {
        return NextResponse.json({ message: "No FCM tokens found", successCount: 0 });
      }

      const payload = {
        notification: { title, body },
        data: { link: link || "/", type },
        webpush: {
          headers: {
            Urgency: "high",
            TTL: "86400",
          },
          notification: {
            icon: iconUrl,
            badge: iconUrl,
            requireInteraction: true,
            tag: `notify-${type}-${Date.now()}`,
            renotify: true,
          },
          fcmOptions: { link: link || "/" },
        },
        tokens,
      };
      const response = await adminMessaging.sendEachForMulticast(payload);

      if (response.failureCount > 0) {
        try {
          const FieldValue = (await import("firebase-admin/firestore")).FieldValue;
          for (let idx = 0; idx < response.responses.length; idx++) {
            const resp = response.responses[idx];
            if (
              !resp.success &&
              (resp.error?.code === "messaging/registration-token-not-registered" ||
                resp.error?.code === "messaging/invalid-registration-token")
            ) {
              const deadToken = tokens[idx];
              const uids = tokenToUserIds.get(deadToken) || [];
              for (const uid of uids) {
                await adminDb
                  .collection("users")
                  .doc(uid)
                  .update({
                    fcm_tokens: FieldValue.arrayRemove(deadToken),
                  })
                  .catch(() => {});
              }
            }
          }
        } catch (e) {
          console.error("Cleanup error (ALL):", e);
        }
      }

      return NextResponse.json({
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
      });
    }

    const userDoc = await adminDb.collection("users").doc(targetUserId).get();

    if (!userDoc.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userData = userDoc.data();
    const settings = userData?.notification_settings || {
      releases: true,
      likes: true,
      replies: true,
      social: true,
    };
    const tokens: string[] = Array.isArray(userData?.fcm_tokens)
      ? userData.fcm_tokens
      : [];

    if (settings[type] === false) {
      return NextResponse.json({ message: "Notification disabled by user" });
    }

    if (tokens.length === 0) {
      return NextResponse.json({ message: "No FCM tokens found for user", successCount: 0 });
    }

    const payload = {
      notification: { title, body },
      data: { link: link || "/", type },
      webpush: {
        headers: {
          Urgency: "high",
          TTL: "86400",
        },
        notification: {
          icon: iconUrl,
          badge: iconUrl,
          requireInteraction: true,
          tag: `notify-${type}-${Date.now()}`,
          renotify: true,
        },
        fcmOptions: { link: link || "/" },
      },
      tokens,
    };

    const response = await adminMessaging.sendEachForMulticast(payload);

    // Cleanup dead tokens
    if (response.failureCount > 0) {
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (
          !resp.success &&
          (resp.error?.code === "messaging/registration-token-not-registered" ||
            resp.error?.code === "messaging/invalid-registration-token")
        ) {
          failedTokens.push(tokens[idx]);
        }
      });

      if (failedTokens.length > 0) {
        try {
          const FieldValue = (await import("firebase-admin/firestore")).FieldValue;
          await adminDb.collection("users").doc(targetUserId).update({
            fcm_tokens: FieldValue.arrayRemove(...failedTokens),
          });
        } catch (e) {
          console.error("Cleanup error", e);
        }
      }
    }

    return NextResponse.json({
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
  } catch (error: any) {
    console.error("Error sending notification:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


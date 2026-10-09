import { NextResponse } from "next/server";


export async function POST(req: Request) {
  try {
    const { adminDb, adminMessaging } = await import("@/lib/firebase-admin");
    const { targetUserId, title, body, type, link, excludeUserId } = await req.json();

    if (!targetUserId || !title || !body || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (targetUserId === "ALL") {
      const usersSnap = await adminDb.collection("users").get();
      let tokens: string[] = [];
      usersSnap.forEach((doc: any) => {
        if (excludeUserId && doc.id === excludeUserId) return;
        const userData = doc.data();
        const settings = userData?.notification_settings || { releases: true, likes: true, replies: true, social: true };
        if (settings[type] !== false && userData.fcm_tokens) {
          tokens.push(...userData.fcm_tokens);
        }
      });

      if (tokens.length === 0) return NextResponse.json({ message: "No FCM tokens found" });

      const payload = {
        notification: { title, body },
        data: { link: link || "/", type },
        webpush: {
          headers: { Urgency: "high" },
          notification: { icon: "https://anitracker-delta.vercel.app/weebcheck-192x192.png" },
          fcmOptions: { link: link || "/" }
        },
        tokens,
      };
      const response = await adminMessaging.sendEachForMulticast(payload);
      return NextResponse.json({ success: true, successCount: response.successCount });
    }

    const userDoc = await adminDb.collection("users").doc(targetUserId).get();
    
    if (!userDoc.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userData = userDoc.data();
    const settings = userData?.notification_settings || { releases: true, likes: true, replies: true, social: true };
    const tokens = userData?.fcm_tokens || [];

    if (settings[type] === false) {
      return NextResponse.json({ message: "Notification disabled by user" });
    }

    if (tokens.length === 0) {
      return NextResponse.json({ message: "No FCM tokens found for user" });
    }

    const payload = {
      notification: { title, body },
      data: { link: link || "/", type },
      webpush: {
        headers: { Urgency: "high" },
        notification: { icon: "https://anitracker-delta.vercel.app/weebcheck-192x192.png" },
        fcmOptions: { link: link || "/" }
      },
      tokens,
    };

    const response = await adminMessaging.sendEachForMulticast(payload);
    
    // Cleanup dead tokens
    if (response.failureCount > 0) {
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
          failedTokens.push(tokens[idx]);
        }
      });
      
      if (failedTokens.length > 0) {
        try {
          const FieldValue = (await import("firebase-admin/firestore")).FieldValue;
          if (targetUserId !== "ALL") {
            await adminDb.collection("users").doc(targetUserId).update({
              fcm_tokens: FieldValue.arrayRemove(...failedTokens)
            });
          } else {
             // For ALL, we don't know easily which token belongs to whom, but it's a minor optimization, they will be cleaned up next time they receive a direct notification, or we could query the DB. We'll skip for now.
          }
        } catch(e) { console.error("Cleanup error", e); }
      }
    }
    
    return NextResponse.json({ success: true, successCount: response.successCount });
  } catch (error: any) {
    console.error("Error sending notification:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

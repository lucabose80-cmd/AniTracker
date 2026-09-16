import { NextResponse } from "next/server";
import { adminDb, adminMessaging } from "@/lib/firebase-admin";

export async function POST(req: Request) {
  try {
    const { targetUserId, title, body, type, link } = await req.json();

    if (!targetUserId || !title || !body || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (targetUserId === "ALL") {
      const usersSnap = await adminDb.collection("users").get();
      let tokens: string[] = [];
      usersSnap.forEach((doc: any) => {
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
        tokens,
      };
      const response = await adminMessaging.sendMulticast(payload);
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
      tokens,
    };

    const response = await adminMessaging.sendMulticast(payload);
    return NextResponse.json({ success: true, successCount: response.successCount });
  } catch (error: any) {
    console.error("Error sending notification:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

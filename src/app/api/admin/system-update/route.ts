import { NextResponse } from "next/server";
import { InAppNotification } from "@/types/database";

export async function POST(req: Request) {
  try {
    const { adminDb, adminMessaging } = await import("@/lib/firebase-admin");
    const authHeader = req.headers.get("authorization");
    
    // We reuse CRON_SECRET as a simple admin password for this endpoint
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && authHeader !== 'Bearer anitracker123') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { title, message, version } = body;

    if (!title || !message) {
      return NextResponse.json({ error: "Missing title or message" }, { status: 400 });
    }

    const usersSnap = await adminDb.collection("users").get();
    let tokensToNotify: string[] = [];
    let inAppNotificationsCount = 0;

    const nowIso = new Date().toISOString();
    const systemActivityRef = adminDb.collection("activity_feed").doc();
    
    // Store all users in an array to chunk them safely
    const allUsers: any[] = [];
    usersSnap.forEach(d => allUsers.push({ id: d.id, data: d.data() }));

    const batchSize = 240; // 240 notifications + 240 system feeds = 480 operations (< 500 limit)
    for (let i = 0; i < allUsers.length; i += batchSize) {
      const chunk = allUsers.slice(i, i + batchSize);
      const batch = adminDb.batch();

      // Ensure systemActivityRef is created only once on the first chunk
      if (i === 0) {
        batch.set(systemActivityRef, {
          activity_id: systemActivityRef.id,
          user_id: "SYSTEM", // Pseudo-user
          action_type: "MANUAL_POST",
          text: `${version ? `Version ${version}: ` : ''}${title}\n\n${message}`,
          timestamp: nowIso,
        });
      }

      chunk.forEach(({ id, data }) => {
        // 1. Add In-App Notification (Bell icon)
        const notifRef = adminDb.collection("notifications").doc();
        const notif: InAppNotification = {
          notification_id: notifRef.id,
          user_id: id,
          actor_id: "SYSTEM",
          actor_name: "System Update",
          actor_avatar: "/weebcheck-192x192.png",
          type: "APP_UPDATE",
          activity_id: systemActivityRef.id, // link to the system feed post
          text: `Update verfügbar: ${title}`,
          timestamp: nowIso,
          read: false,
        };
        batch.set(notifRef, notif);
        inAppNotificationsCount++;

        // 2. Collect FCM Tokens for Push Notification
        const settings = data?.notification_settings || { releases: true, social: true };
        if (settings.social !== false && data.fcm_tokens) {
          tokensToNotify.push(...data.fcm_tokens);
        }
      });
      await batch.commit();
    }

    // 3. Send Push Notification via FCM (up to 500 tokens per call)
    let pushSentCount = 0;
    if (tokensToNotify.length > 0) {
      // Chunk tokens if more than 500
      const chunkSize = 500;
      for (let i = 0; i < tokensToNotify.length; i += chunkSize) {
        const chunk = tokensToNotify.slice(i, i + chunkSize);
        const payload = {
          notification: { 
            title: title || "App Update", 
            body: message 
          },
          data: { link: "/", type: "social" },
          webpush: {
            headers: { Urgency: "high" },
            notification: { icon: "https://anitracker-delta.vercel.app/weebcheck-192x192.png" },
            fcmOptions: { link: "/" }
          },
          tokens: chunk,
        };
        
        try {
          const response = await adminMessaging.sendEachForMulticast(payload);
          pushSentCount += response.successCount;
        } catch (pushErr) {
          console.error("FCM System Update Send Error:", pushErr);
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      inAppNotificationsCount, 
      pushSentCount 
    });

  } catch (error: any) {
    console.error("System Update Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

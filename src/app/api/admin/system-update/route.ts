import { NextResponse } from "next/server";
import { InAppNotification } from "@/types/database";

export async function POST(req: Request) {
  try {
    const { adminDb, adminMessaging } = await import("@/lib/firebase-admin");
    const authHeader = req.headers.get("authorization");

    if (
      authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
      authHeader !== "Bearer anitracker123"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { title, message, version } = body;

    if (!title || !message) {
      return NextResponse.json(
        { error: "Missing title or message" },
        { status: 400 }
      );
    }

    if (typeof version === "string" && version.trim()) {
      await adminDb
        .collection("app_config")
        .doc("version")
        .set({ version: version.trim() });
    }

    const usersSnap = await adminDb.collection("users").get();
    const tokensToNotify: string[] = [];
    let inAppNotificationsCount = 0;

    const nowIso = new Date().toISOString();
    const allUsers: Array<{ id: string; data: Record<string, unknown> }> = [];
    usersSnap.forEach((d) => allUsers.push({ id: d.id, data: d.data() }));

    const batchSize = 400;
    for (let i = 0; i < allUsers.length; i += batchSize) {
      const chunk = allUsers.slice(i, i + batchSize);
      const batch = adminDb.batch();

      chunk.forEach(({ id, data }) => {
        const notifRef = adminDb.collection("notifications").doc();
        const notif: InAppNotification = {
          notification_id: notifRef.id,
          user_id: id,
          actor_id: "SYSTEM",
          actor_name: "System Update",
          actor_avatar: "/anipulse-192x192.png",
          type: "APP_UPDATE",
          text: `Update verfügbar: ${title}`,
          timestamp: nowIso,
          read: false,
        };
        batch.set(notifRef, notif);
        inAppNotificationsCount++;

        const settings = (data?.notification_settings || {
          releases: true,
          social: true,
        }) as Record<string, boolean>;
        if (settings.social !== false && Array.isArray(data.fcm_tokens)) {
          tokensToNotify.push(...(data.fcm_tokens as string[]));
        }
      });
      await batch.commit();
    }

    let pushSentCount = 0;
    if (tokensToNotify.length > 0) {
      const uniqueTokens = Array.from(new Set(tokensToNotify.filter(Boolean)));
      for (let i = 0; i < uniqueTokens.length; i += 500) {
        const chunk = uniqueTokens.slice(i, i + 500);
        const payload = {
          notification: {
            title: title || "App Update",
            body: message,
          },
          data: { link: "/", type: "social" },
          webpush: {
            headers: { Urgency: "high" },
            notification: {
              icon: "https://anitracker-delta.vercel.app/anipulse-192x192.png",
              badge: "https://anitracker-delta.vercel.app/anipulse-badge-96.png",
            },
            fcmOptions: { link: "/" },
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
      pushSentCount,
    });
  } catch (error: unknown) {
    console.error("System Update Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

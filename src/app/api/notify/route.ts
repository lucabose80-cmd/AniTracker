import { NextResponse } from "next/server";

const DEFAULT_ICON_URL = "https://anitracker-delta.vercel.app/anipulse-192x192.png";
// Android status bar & lock screen require a monochrome transparent PNG for the small badge icon
const BADGE_URL = "https://anitracker-delta.vercel.app/anipulse-badge-96.png";

const COVER_CACHE = new Map<number, { url: string | null; ts: number }>();
const COVER_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function normalizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("http://")) return trimmed.replace(/^http:\/\//, "https://");
  return null;
}

async function resolveNotificationIcon(
  icon?: unknown,
  workId?: unknown,
  link?: unknown
): Promise<string> {
  const directIcon = normalizeHttpsUrl(icon);
  if (directIcon) {
    return directIcon;
  }

  let parsedId: number | null = null;
  if (typeof workId === "number" && Number.isInteger(workId) && workId > 0) {
    parsedId = workId;
  } else if (typeof workId === "string" && /^\d+$/.test(workId.trim())) {
    parsedId = parseInt(workId.trim(), 10);
  } else if (typeof link === "string") {
    const match = link.match(/^\/work\/(\d+)/);
    if (match) {
      parsedId = parseInt(match[1], 10);
    }
  }

  if (!parsedId || Number.isNaN(parsedId) || parsedId <= 0) {
    return DEFAULT_ICON_URL;
  }

  const cached = COVER_CACHE.get(parsedId);
  if (cached && Date.now() - cached.ts < COVER_CACHE_TTL_MS) {
    return cached.url || DEFAULT_ICON_URL;
  }

  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: `query($id: Int) { Media(id: $id) { coverImage { large medium } } }`,
        variables: { id: parsedId },
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      const rawUrl =
        json?.data?.Media?.coverImage?.large ||
        json?.data?.Media?.coverImage?.medium ||
        null;
      const validUrl = normalizeHttpsUrl(rawUrl);
      COVER_CACHE.set(parsedId, { url: validUrl, ts: Date.now() });
      return validUrl || DEFAULT_ICON_URL;
    }
  } catch (err) {
    console.warn("Could not resolve AniList cover for push notification:", err);
  }

  return DEFAULT_ICON_URL;
}

export async function POST(req: Request) {
  try {
    const { adminDb, adminMessaging } = await import("@/lib/firebase-admin");
    const {
      targetUserId,
      title,
      body,
      type,
      link,
      excludeUserId,
      tag: customTag,
      forceNotification,
      icon: customIcon,
      workId,
    } = await req.json();

    if (!targetUserId || !title || !body || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const iconUrl = await resolveNotificationIcon(customIcon, workId, link);
    const badgeUrl = BADGE_URL;
    const resolvedTag =
      customTag || `anipulse-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
        if (
          (forceNotification || settings[type] !== false) &&
          Array.isArray(userData.fcm_tokens)
        ) {
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
        data: { link: link || "/", type, tag: resolvedTag, icon: iconUrl },
        webpush: {
          headers: {
            Urgency: "high",
            TTL: "86400",
          },
          notification: {
            title,
            body,
            icon: iconUrl,
            badge: badgeUrl,
            requireInteraction: true,
            tag: resolvedTag,
            renotify: true,
            silent: false,
            vibrate: [200, 100, 200],
            timestamp: Date.now(),
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

    if (!forceNotification && settings[type] === false) {
      return NextResponse.json({ message: "Notification disabled by user" });
    }

    if (tokens.length === 0) {
      return NextResponse.json({ message: "No FCM tokens found for user", successCount: 0 });
    }

    const payload = {
      notification: { title, body },
      data: { link: link || "/", type, tag: resolvedTag, icon: iconUrl },
      webpush: {
        headers: {
          Urgency: "high",
          TTL: "86400",
        },
        notification: {
          title,
          body,
          icon: iconUrl,
          badge: badgeUrl,
          requireInteraction: true,
          tag: resolvedTag,
          renotify: true,
          silent: false,
          vibrate: [200, 100, 200],
          timestamp: Date.now(),
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


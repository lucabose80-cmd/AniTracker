import { NextResponse } from "next/server";

const DEFAULT_ICON_URL =
  "https://anitracker-delta.vercel.app/anipulse-192x192.png";
// Android status bar & lock screen require a monochrome transparent PNG for the small badge icon
const BADGE_URL = "https://anitracker-delta.vercel.app/anipulse-badge-96.png";

const COVER_CACHE = new Map<number, { url: string | null; ts: number }>();
const COVER_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function normalizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("http://")) {
    return trimmed.replace(/^http:\/\//, "https://");
  }
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
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
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
    const { FieldValue } = await import("firebase-admin/firestore");
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
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const iconUrl = await resolveNotificationIcon(customIcon, workId, link);
    const badgeUrl = BADGE_URL;
    const resolvedTag =
      customTag ||
      `anipulse-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const sendChunked = async (
      tokens: string[],
      tokenToUserIds: Map<string, string[]>
    ) => {
      let totalSuccess = 0;
      let totalFailure = 0;

      for (let i = 0; i < tokens.length; i += 500) {
        const chunk = tokens.slice(i, i + 500);
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
          tokens: chunk,
        };

        const response = await adminMessaging.sendEachForMulticast(payload);
        totalSuccess += response.successCount;
        totalFailure += response.failureCount;

        if (response.failureCount > 0) {
          for (let idx = 0; idx < response.responses.length; idx++) {
            const resp = response.responses[idx];
            if (
              !resp.success &&
              (resp.error?.code === "messaging/registration-token-not-registered" ||
                resp.error?.code === "messaging/invalid-registration-token")
            ) {
              const deadToken = chunk[idx];
              const uids = tokenToUserIds.get(deadToken) || [];
              for (const uid of uids) {
                await adminDb
                  .collection("users")
                  .doc(uid)
                  .update({ fcm_tokens: FieldValue.arrayRemove(deadToken) })
                  .catch(() => {});
              }
            }
          }
        }
      }

      return { successCount: totalSuccess, failureCount: totalFailure };
    };

    if (targetUserId === "ALL") {
      const usersSnap = await adminDb.collection("users").get();
      const tokenToUserIds = new Map<string, string[]>();
      const tokens: string[] = [];

      usersSnap.forEach((docSnap) => {
        if (excludeUserId && docSnap.id === excludeUserId) return;
        const userData = docSnap.data();
        const settings = (userData?.notification_settings || {
          releases: true,
          likes: true,
          replies: true,
          social: true,
        }) as Record<string, boolean>;
        if (
          (forceNotification || settings[type] !== false) &&
          Array.isArray(userData.fcm_tokens)
        ) {
          (userData.fcm_tokens as string[]).forEach((tk) => {
            if (!tk) return;
            if (!tokenToUserIds.has(tk)) {
              tokenToUserIds.set(tk, []);
              tokens.push(tk);
            }
            tokenToUserIds.get(tk)!.push(docSnap.id);
          });
        }
      });

      if (tokens.length === 0) {
        return NextResponse.json({
          message: "No FCM tokens found",
          successCount: 0,
        });
      }

      const { successCount, failureCount } = await sendChunked(
        tokens,
        tokenToUserIds
      );
      return NextResponse.json({
        success: true,
        successCount,
        failureCount,
      });
    }

    const userDoc = await adminDb.collection("users").doc(targetUserId).get();
    if (!userDoc.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userData = userDoc.data();
    const settings = (userData?.notification_settings || {
      releases: true,
      likes: true,
      replies: true,
      social: true,
    }) as Record<string, boolean>;
    const tokens: string[] = Array.isArray(userData?.fcm_tokens)
      ? userData.fcm_tokens
      : [];

    if (!forceNotification && settings[type] === false) {
      return NextResponse.json({ message: "Notification disabled by user" });
    }

    if (tokens.length === 0) {
      return NextResponse.json({
        message: "No FCM tokens found for user",
        successCount: 0,
      });
    }

    const tokenMap = new Map<string, string[]>();
    tokens.forEach((tk) => tokenMap.set(tk, [targetUserId]));

    const { successCount, failureCount } = await sendChunked(tokens, tokenMap);
    return NextResponse.json({
      success: true,
      successCount,
      failureCount,
    });
  } catch (error: unknown) {
    console.error("Error sending notification:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

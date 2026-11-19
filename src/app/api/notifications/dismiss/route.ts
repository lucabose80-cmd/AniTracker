import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type DismissAction =
  | "delete_notification"
  | "delete_all_notifications"
  | "dismiss_activity"
  | "dismiss_all_activities"
  | "clear_bell";

type BellTab = "ALL" | "RELEASES" | "COMMUNITY";

const MAX_DISMISSED_IDS = 500;

function isReleaseNotificationType(type: unknown): boolean {
  return (
    type === "SYSTEM" ||
    type === "APP_UPDATE" ||
    type === "NEW_EPISODE_THREAD"
  );
}

function mergeDismissedIds(existing: unknown, toAdd: string[]): string[] {
  const base = Array.isArray(existing)
    ? existing.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  const seen = new Set(base);
  const merged = [...base];
  for (const id of toAdd) {
    if (typeof id === "string" && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }
  return merged.length > MAX_DISMISSED_IDS
    ? merged.slice(-MAX_DISMISSED_IDS)
    : merged;
}

function maxIsoTimestamp(a?: unknown, b?: unknown): string {
  const tsA = typeof a === "string" ? Date.parse(a) : NaN;
  const tsB = typeof b === "string" ? Date.parse(b) : NaN;
  if (!Number.isNaN(tsA) && !Number.isNaN(tsB)) {
    return tsA >= tsB ? new Date(tsA).toISOString() : new Date(tsB).toISOString();
  }
  if (!Number.isNaN(tsA)) return new Date(tsA).toISOString();
  if (!Number.isNaN(tsB)) return new Date(tsB).toISOString();
  return new Date().toISOString();
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { verifyFirebaseIdToken, adminDb } = await import("@/lib/firebase-admin");
    let uid: string;
    try {
      const decoded = await verifyFirebaseIdToken(match[1]);
      uid = decoded.uid;
    } catch {
      return NextResponse.json({ error: "Invalid auth token" }, { status: 401 });
    }

    const body = await req.json();
    const action = body?.action as DismissAction | undefined;
    const tab: BellTab =
      body?.tab === "RELEASES" || body?.tab === "COMMUNITY" ? body.tab : "ALL";
    const nowIso = new Date().toISOString();

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    // 1. Soft-delete a single InAppNotification
    if (action === "delete_notification") {
      const notificationId =
        typeof body.notificationId === "string" ? body.notificationId.trim() : "";
      if (!notificationId) {
        return NextResponse.json({ error: "Missing notificationId" }, { status: 400 });
      }

      const notifRef = adminDb.collection("notifications").doc(notificationId);
      const snap = await notifRef.get();
      if (snap.exists) {
        if (snap.data()?.user_id !== uid) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        await notifRef.update({
          deleted: true,
          read: true,
          deleted_at: nowIso,
        });
        return NextResponse.json({ success: true, deletedCount: 1 });
      }

      // Fallback if document ID differs from notification_id field
      const qSnap = await adminDb
        .collection("notifications")
        .where("user_id", "==", uid)
        .where("notification_id", "==", notificationId)
        .get();

      if (!qSnap.empty) {
        const batch = adminDb.batch();
        qSnap.docs.forEach((d) => {
          batch.update(d.ref, { deleted: true, read: true, deleted_at: nowIso });
        });
        await batch.commit();
      }

      return NextResponse.json({ success: true, deletedCount: qSnap.size });
    }

    let deletedNotificationsCount = 0;

    // 2. Soft-delete all matching notifications for this user
    if (
      action === "delete_all_notifications" ||
      (action === "clear_bell" && (tab === "ALL" || tab === "RELEASES"))
    ) {
      const qSnap = await adminDb
        .collection("notifications")
        .where("user_id", "==", uid)
        .get();

      const docsToSoftDelete = qSnap.docs.filter((d) => {
        const data = d.data();
        if (data?.deleted === true) return false;
        if (tab === "RELEASES" && !isReleaseNotificationType(data?.type)) {
          return false;
        }
        return true;
      });

      for (let i = 0; i < docsToSoftDelete.length; i += 400) {
        const chunk = docsToSoftDelete.slice(i, i + 400);
        const batch = adminDb.batch();
        chunk.forEach((d) => {
          batch.update(d.ref, {
            deleted: true,
            read: true,
            deleted_at: nowIso,
          });
        });
        await batch.commit();
      }
      deletedNotificationsCount = docsToSoftDelete.length;
    }

    // 3. Persist single dismissed community activity ID on user profile
    if (action === "dismiss_activity") {
      const activityId =
        typeof body.activityId === "string" ? body.activityId.trim() : "";
      if (!activityId) {
        return NextResponse.json({ error: "Missing activityId" }, { status: 400 });
      }

      const userRef = adminDb.collection("users").doc(uid);
      const userSnap = await userRef.get();
      const merged = mergeDismissedIds(userSnap.data()?.dismissed_activity_ids, [
        activityId,
      ]);

      await userRef.set(
        { dismissed_activity_ids: merged },
        { merge: true }
      );

      return NextResponse.json({
        success: true,
        dismissedCount: merged.length,
      });
    }

    // 4. Persist dismissed_activities_before & visible activityIds on user profile
    if (
      action === "dismiss_all_activities" ||
      (action === "clear_bell" && (tab === "ALL" || tab === "COMMUNITY"))
    ) {
      const incomingIds: string[] = Array.isArray(body.activityIds)
        ? body.activityIds.filter((x: unknown): x is string => typeof x === "string")
        : [];
      const userRef = adminDb.collection("users").doc(uid);
      const userSnap = await userRef.get();
      const existingData = userSnap.data() || {};

      const mergedIds = mergeDismissedIds(
        existingData.dismissed_activity_ids,
        incomingIds
      );
      const nextBefore = maxIsoTimestamp(
        existingData.dismissed_activities_before,
        body.dismissBefore || nowIso
      );

      await userRef.set(
        {
          dismissed_activity_ids: mergedIds,
          dismissed_activities_before: nextBefore,
        },
        { merge: true }
      );

      return NextResponse.json({
        success: true,
        deletedNotificationsCount,
        dismissedActivitiesBefore: nextBefore,
      });
    }

    return NextResponse.json({
      success: true,
      deletedNotificationsCount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in /api/notifications/dismiss:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

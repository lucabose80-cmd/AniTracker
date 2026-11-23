import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit,
  deleteDoc,
  updateDoc,
  increment,
  getDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  ActivityFeed,
  ActivityComment,
  InAppNotification,
} from "@/types/database";
import { getUserProfile } from "@/lib/db/users";

export async function createActivity(
  user_id: string,
  action_type: ActivityFeed["action_type"],
  work_id?: string,
  text?: string,
  details?: string,
  episode_num?: number
): Promise<ActivityFeed | null> {
  if (!db) return null;

  const feedRef = collection(db, "activity_feed");
  const newDocRef = doc(feedRef);
  const activity_id = newDocRef.id;
  const timestamp = new Date().toISOString();

  const newActivity: ActivityFeed = {
    activity_id,
    user_id,
    action_type,
    timestamp,
  };
  if (work_id !== undefined) newActivity.work_id = work_id;
  if (text !== undefined) newActivity.text = text;
  if (details !== undefined) newActivity.details = details;
  if (episode_num !== undefined) newActivity.episode_num = episode_num;

  await setDoc(newDocRef, newActivity);

  if (action_type === "MANUAL_POST") {
    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "ALL",
        excludeUserId: user_id,
        title: "Neuer Beitrag",
        body: text || "Jemand hat etwas im Feed gepostet.",
        type: "social",
        link: `/?activity_id=${activity_id}`,
        ...(work_id ? { workId: work_id } : {}),
      }),
    }).catch(console.error);
  } else if (action_type === "RATING") {
    let actorName = "Jemand";
    let actorAvatar = "";
    try {
      const actorProfile = await getUserProfile(user_id);
      if (actorProfile?.username) actorName = actorProfile.username;
      if (actorProfile?.avatar_url) actorAvatar = actorProfile.avatar_url;
    } catch (e) {
      console.error("Failed to fetch actor profile for rating notification:", e);
    }

    const isUpdate = Boolean(
      text && /(angepasst|geändert|aktualisiert)/i.test(text)
    );
    const pushTitle = isUpdate
      ? `${actorName} hat eine Bewertung angepasst`
      : `${actorName} hat ein Werk bewertet`;
    const bodyText = text || `${actorName} hat ein Werk bewertet.`;

    try {
      const usersSnap = await getDocs(collection(db, "users"));
      const notifCol = collection(db, "notifications");
      await Promise.all(
        usersSnap.docs
          .filter((uDoc) => uDoc.id !== user_id)
          .map((uDoc) => {
            const notifRef = doc(notifCol);
            const payload: Record<string, unknown> = {
              notification_id: notifRef.id,
              user_id: uDoc.id,
              actor_id: user_id,
              actor_name: actorName.slice(0, 100),
              actor_avatar: actorAvatar,
              type: "RATING_UPDATE",
              activity_id,
              text: bodyText.slice(0, 1000),
              timestamp,
              read: false,
            };
            if (work_id) payload.work_id = work_id;
            return setDoc(notifRef, payload);
          })
      );
    } catch (e) {
      console.warn("Could not create in-app notifications for rating:", e);
    }

    fetch("/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetUserId: "ALL",
        excludeUserId: user_id,
        title: pushTitle,
        body: bodyText,
        type: "social",
        link: work_id ? `/work/${work_id}` : `/?activity_id=${activity_id}`,
        ...(work_id ? { workId: work_id } : {}),
      }),
    }).catch(console.error);
  }

  return newActivity;
}

export async function getGlobalFeed(
  limitCount: number = 50
): Promise<ActivityFeed[]> {
  if (!db) return [];

  const feedRef = collection(db, "activity_feed");
  const q = query(feedRef, orderBy("timestamp", "desc"), limit(limitCount));

  const snapshot = await getDocs(q);
  const activities: ActivityFeed[] = [];
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    activities.push({
      ...data,
      activity_id: data.activity_id || docSnap.id,
    } as ActivityFeed);
  });

  return activities;
}

export async function deleteActivity(
  activityId: string,
  userId?: string
): Promise<void> {
  const { auth } = await import("@/lib/firebase");
  const uid = userId || auth?.currentUser?.uid;
  if (!uid) throw new Error("Nicht eingeloggt");

  const res = await fetch("/api/feed/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activityId, userId: uid }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Fehler beim Löschen");
  }
  const { useAppStore } = await import("@/lib/store");
  useAppStore.getState().triggerReload();
}

export async function addActivityComment(
  activityId: string,
  userId: string,
  text: string,
  parentCommentId?: string
): Promise<ActivityComment | null> {
  if (!db) return null;
  const commentsRef = collection(db, "activity_comments");
  const newDocRef = doc(commentsRef);
  const comment_id = newDocRef.id;
  const timestamp = new Date().toISOString();

  const comment: ActivityComment = {
    comment_id,
    activity_id: activityId,
    user_id: userId,
    text,
    timestamp,
  };
  if (parentCommentId) comment.parent_comment_id = parentCommentId;

  await setDoc(newDocRef, comment);

  const activityRef = doc(db, "activity_feed", activityId);
  try {
    await updateDoc(activityRef, { comments_count: increment(1) });

    const activitySnap = await getDoc(activityRef);
    if (activitySnap.exists()) {
      const activityData = activitySnap.data() as ActivityFeed;
      const actorProfile = await getUserProfile(userId);
      const actorName = actorProfile?.username || "Unbekannt";
      const actorAvatar = actorProfile?.avatar_url || "";

      let workTitle = activityData.review_items?.[0]?.work_title || "";
      let mediaType: "ANIME" | "MANGA" =
        activityData.review_items?.[0]?.media_type || "ANIME";
      let workCover: string | undefined =
        activityData.review_items?.[0]?.work_cover;
      const resolvedWorkId =
        activityData.work_id ||
        activityData.review_items?.[0]?.work_id ||
        activityData.work_ids?.[0];

      if (resolvedWorkId && (!workTitle || !workCover)) {
        try {
          const { getWorkTitleAndType } = await import("@/lib/anilist");
          const info = await getWorkTitleAndType(resolvedWorkId);
          if (info) {
            if (!workTitle) workTitle = info.title;
            mediaType = info.type;
            if (!workCover && info.coverImage) {
              workCover = info.coverImage;
            }
          }
        } catch {
          // ignore AniList lookup error
        }
      }

      const unit = mediaType === "MANGA" ? "Kapitel" : "Folge";
      const resolvedEpNum =
        typeof activityData.episode_num === "number"
          ? activityData.episode_num
          : activityData.review_items?.[0]?.episode_num;
      const notificationsRef = collection(db, "notifications");

      const buildNotifPayload = (
        notifId: string,
        recipientId: string,
        type: InAppNotification["type"]
      ): Record<string, unknown> => {
        const payload: Record<string, unknown> = {
          notification_id: notifId,
          user_id: recipientId,
          actor_id: userId,
          actor_name: actorName.slice(0, 100),
          actor_avatar: actorAvatar,
          type,
          activity_id: activityId,
          comment_id,
          text: text.slice(0, 1000),
          timestamp,
          read: false,
        };
        if (resolvedWorkId) payload.work_id = resolvedWorkId;
        if (workTitle) payload.work_title = workTitle.slice(0, 200);
        if (mediaType) payload.media_type = mediaType;
        if (typeof resolvedEpNum === "number") payload.episode_num = resolvedEpNum;
        return payload;
      };

      // 1. Notify Parent Comment Author (if reply)
      if (parentCommentId) {
        const parentDoc = await getDoc(
          doc(db, "activity_comments", parentCommentId)
        );
        if (parentDoc.exists()) {
          const parentData = parentDoc.data() as ActivityComment;
          if (parentData.user_id !== userId) {
            const notifRef = doc(notificationsRef);
            await setDoc(
              notifRef,
              buildNotifPayload(
                notifRef.id,
                parentData.user_id,
                "REPLY_TO_COMMENT"
              )
            );

            fetch("/api/notify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                targetUserId: parentData.user_id,
                title: `${actorName} zu deinem Kommentar${workTitle ? ` (${workTitle})` : ""}`,
                body: text,
                type: "replies",
                link: `/?activity_id=${activityId}`,
                icon: workCover,
                workId: resolvedWorkId,
              }),
            }).catch(console.error);
          }
        }
      }
      // 2. Notify Review/Activity Author (if not reply, and not their own post)
      else if (activityData.user_id !== userId) {
        const notifRef = doc(notificationsRef);
        await setDoc(
          notifRef,
          buildNotifPayload(
            notifRef.id,
            activityData.user_id,
            "COMMENT_ON_REVIEW"
          )
        );

        fetch("/api/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetUserId: activityData.user_id,
            title: `${actorName} zu deinem Review${workTitle ? ` (${workTitle})` : ""}${typeof resolvedEpNum === "number" ? ` · ${unit} ${resolvedEpNum}` : ""}`,
            body: text,
            type: "replies",
            link: `/?activity_id=${activityId}`,
            icon: workCover,
            workId: resolvedWorkId,
          }),
        }).catch(console.error);
      }
    }
  } catch (err) {
    console.error("Error updating comment count / notifications:", err);
  }

  return comment;
}

export async function getActivityComments(
  activityId: string
): Promise<ActivityComment[]> {
  if (!db || !activityId) return [];
  const commentsRef = collection(db, "activity_comments");
  // Properly filter by activity_id in Firestore so >100 total comments never cause missing replies
  const q = query(commentsRef, where("activity_id", "==", activityId));
  const snapshot = await getDocs(q);

  const comments: ActivityComment[] = [];
  snapshot.forEach((docSnap) => {
    comments.push(docSnap.data() as ActivityComment);
  });

  return comments.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

export async function deleteActivityComment(
  commentId: string,
  activityId: string
): Promise<void> {
  if (!db) return;
  const docRef = doc(db, "activity_comments", commentId);
  await deleteDoc(docRef);

  const activityRef = doc(db, "activity_feed", activityId);
  try {
    const snap = await getDoc(activityRef);
    const currentCount = Number(snap.data()?.comments_count) || 0;
    if (currentCount > 0) {
      await updateDoc(activityRef, { comments_count: increment(-1) });
    }
  } catch (e) {
    console.error("Failed to decrement comments_count", e);
  }
}

export async function getInAppNotifications(
  userId: string
): Promise<InAppNotification[]> {
  if (!db || !userId) return [];
  try {
    const notifRef = collection(db, "notifications");
    const q = query(notifRef, where("user_id", "==", userId));
    const snap = await getDocs(q);

    const notifications: InAppNotification[] = [];
    snap.forEach((d) => {
      const data = d.data();
      if (data.deleted === true) return;
      if (
        data.type === "NEW_EPISODE_THREAD" ||
        data.type === "COMMENT_ON_THREAD"
      ) {
        return;
      }
      notifications.push({
        ...data,
        notification_id: d.id,
      } as InAppNotification);
    });

    return notifications
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 50);
  } catch (err) {
    console.error("Error in getInAppNotifications:", err);
    return [];
  }
}

async function callDismissApi(
  payload: Record<string, unknown>
): Promise<boolean> {
  try {
    const { auth } = await import("@/lib/firebase");
    const currentUser = auth?.currentUser;
    if (!currentUser) return false;
    const token = await currentUser.getIdToken();
    const res = await fetch("/api/notifications/dismiss", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    return res.ok;
  } catch (err) {
    console.error("Error calling /api/notifications/dismiss:", err);
    return false;
  }
}

export async function markNotificationRead(
  notificationId: string
): Promise<void> {
  if (!db || !notificationId) return;
  try {
    const notifRef = doc(db, "notifications", notificationId);
    await updateDoc(notifRef, { read: true });
  } catch (err) {
    console.error("Error marking notification read:", err);
  }
}

export async function deleteNotification(
  notificationId: string
): Promise<void> {
  if (!notificationId) return;
  const ok = await callDismissApi({
    action: "delete_notification",
    notificationId,
  });
  if (ok || !db) return;

  try {
    const notifRef = doc(db, "notifications", notificationId);
    await updateDoc(notifRef, {
      deleted: true,
      read: true,
      deleted_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error deleting notification:", err);
  }
}

export async function deleteAllNotifications(
  userId: string,
  tab: "ALL" | "RELEASES" = "ALL"
): Promise<void> {
  if (!userId) return;
  const ok = await callDismissApi({
    action: "delete_all_notifications",
    tab,
  });
  if (ok || !db) return;

  try {
    const notifRef = collection(db, "notifications");
    const q = query(notifRef, where("user_id", "==", userId));
    const snap = await getDocs(q);
    if (snap.empty) return;

    const nowIso = new Date().toISOString();
    const targets = snap.docs.filter((d) => {
      const data = d.data();
      if (data?.deleted === true) return false;
      if (
        tab === "RELEASES" &&
        data?.type !== "SYSTEM" &&
        data?.type !== "APP_UPDATE"
      ) {
        return false;
      }
      return true;
    });

    for (let i = 0; i < targets.length; i += 400) {
      const chunk = targets.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((d) =>
        batch.update(d.ref, { deleted: true, read: true, deleted_at: nowIso })
      );
      await batch.commit();
    }
  } catch (err) {
    console.error("Error in deleteAllNotifications:", err);
  }
}

export async function dismissCommunityActivity(
  activityId: string
): Promise<void> {
  if (!activityId) return;
  await callDismissApi({
    action: "dismiss_activity",
    activityId,
  });
}

export async function clearBellItems(
  tab: "ALL" | "RELEASES" | "COMMUNITY",
  activityIds: string[],
  dismissBefore: string
): Promise<boolean> {
  return callDismissApi({
    action: "clear_bell",
    tab,
    activityIds,
    dismissBefore,
  });
}

export async function markAllNotificationsRead(
  userIdOrIds: string | string[]
): Promise<void> {
  if (!db || !userIdOrIds) return;

  try {
    if (Array.isArray(userIdOrIds)) {
      if (userIdOrIds.length === 0) return;
      for (let i = 0; i < userIdOrIds.length; i += 400) {
        const chunk = userIdOrIds.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((id) => {
          if (id) batch.update(doc(db, "notifications", id), { read: true });
        });
        await batch.commit();
      }
    } else {
      const notifRef = collection(db, "notifications");
      const q = query(notifRef, where("user_id", "==", userIdOrIds));
      const snap = await getDocs(q);
      const unreadDocs = snap.docs.filter((d) => d.data()?.read === false);

      if (unreadDocs.length === 0) return;

      for (let i = 0; i < unreadDocs.length; i += 400) {
        const chunk = unreadDocs.slice(i, i + 400);
        const batch = writeBatch(db);
        chunk.forEach((d) => {
          batch.update(d.ref, { read: true });
        });
        await batch.commit();
      }
    }
  } catch (err) {
    console.error("Error in markAllNotificationsRead:", err);
  }
}

import { db } from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { ActivityFeed, EpisodeFeedback, ReviewListItem } from "@/types/database";
import { getUserProfile } from "@/lib/db/users";

export function getReviewItemTargetEpisode(item: ReviewListItem): number {
  if (
    typeof item.episode_end === "number" &&
    !Number.isNaN(item.episode_end) &&
    item.episode_end > item.episode_num
  ) {
    return item.episode_end;
  }
  if (Array.isArray(item.episodes) && item.episodes.length > 0) {
    return Math.max(...item.episodes);
  }
  return item.episode_num;
}

export function sanitizeReviewItem(item: ReviewListItem): ReviewListItem {
  const sanitized: ReviewListItem = {
    work_id: item.work_id,
    work_title: item.work_title,
    media_type: item.media_type,
    episode_num: item.episode_num,
    text: item.text,
  };
  if (
    typeof item.episode_end === "number" &&
    !Number.isNaN(item.episode_end) &&
    item.episode_end > item.episode_num
  ) {
    sanitized.episode_end = item.episode_end;
  }
  if (Array.isArray(item.episodes) && item.episodes.length > 0) {
    sanitized.episodes = item.episodes;
  }
  if (
    typeof item.previous_episode === "number" &&
    !Number.isNaN(item.previous_episode) &&
    item.previous_episode >= 0
  ) {
    sanitized.previous_episode = item.previous_episode;
  }
  if (
    typeof item.applied_episode === "number" &&
    !Number.isNaN(item.applied_episode) &&
    item.applied_episode >= 0
  ) {
    sanitized.applied_episode = item.applied_episode;
  }
  if (item.work_cover !== undefined && item.work_cover !== "") {
    sanitized.work_cover = item.work_cover;
  }
  if (typeof item.rating === "number" && !Number.isNaN(item.rating)) {
    sanitized.rating = item.rating;
  }
  return sanitized;
}

function sortFeedbackDesc(a: EpisodeFeedback, b: EpisodeFeedback): number {
  if (b.episode_num !== a.episode_num) {
    return b.episode_num - a.episode_num;
  }
  return b.timestamp.localeCompare(a.timestamp);
}

/**
 * Creates a REVIEW_LIST activity feed post and individual episode_feedback
 * documents for each item so ratings/notes are queryable per work and episode.
 */
export async function createReviewList(
  userId: string,
  title: string,
  items: ReviewListItem[]
): Promise<ActivityFeed | null> {
  if (!db) return null;

  const sanitizedItems = items.map(sanitizeReviewItem);
  const feedRef = collection(db, "activity_feed");
  const newActivityRef = doc(feedRef);
  const activity_id = newActivityRef.id;
  const timestamp = new Date().toISOString();

  const work_ids = Array.from(new Set(sanitizedItems.map((i) => i.work_id)));

  const newActivity: ActivityFeed = {
    activity_id,
    user_id: userId,
    action_type: "REVIEW_LIST",
    text: title,
    review_items: sanitizedItems,
    work_ids,
    reactions: {},
    timestamp,
  };

  await setDoc(newActivityRef, newActivity);

  const feedbackCol = collection(db, "episode_feedback");
  await Promise.all(
    sanitizedItems.map((item) => {
      const fbRef = doc(feedbackCol);
      const feedbackDoc: EpisodeFeedback = {
        feedback_id: fbRef.id,
        user_id: userId,
        work_id: item.work_id,
        episode_num: item.episode_num,
        media_type: item.media_type,
        text: item.text,
        activity_id,
        timestamp,
        reactions: {},
      };
      if (typeof item.rating === "number") {
        feedbackDoc.rating = item.rating;
      }
      return setDoc(fbRef, feedbackDoc);
    })
  );

  let actorName = "Jemand";
  let actorAvatar = "";
  try {
    const profile = await getUserProfile(userId);
    if (profile?.username) {
      actorName = profile.username;
    }
    if (profile?.avatar_url) {
      actorAvatar = profile.avatar_url;
    }
  } catch (e) {
    console.error("Failed to fetch actor profile for notification:", e);
  }

  const workSummary = sanitizedItems
    .map((i) => i.work_title)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  const firstItem = sanitizedItems[0];

  // Create in-app notifications for other users
  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const notifCol = collection(db, "notifications");
    await Promise.all(
      usersSnap.docs
        .filter((uDoc) => uDoc.id !== userId)
        .map((uDoc) => {
          const notifRef = doc(notifCol);
          const payload: Record<string, any> = {
            notification_id: notifRef.id,
            user_id: uDoc.id,
            actor_id: userId,
            actor_name: actorName,
            actor_avatar: actorAvatar,
            type: "REPLY_TO_COMMENT",
            activity_id,
            text:
              title.trim() ||
              (workSummary
                ? `Neues Review zu ${workSummary}`
                : "Neue Episoden-Reviews im Feed."),
            timestamp,
            read: false,
          };
          if (firstItem?.work_id) payload.work_id = firstItem.work_id;
          if (firstItem?.work_title) payload.work_title = firstItem.work_title;
          if (firstItem?.media_type) payload.media_type = firstItem.media_type;
          if (typeof firstItem?.episode_num === "number") {
            payload.episode_num = firstItem.episode_num;
          }
          return setDoc(notifRef, payload);
        })
    );
  } catch (e) {
    console.warn("Could not create in-app notifications for review list:", e);
  }

  fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUserId: "ALL",
      excludeUserId: userId,
      type: "social",
      title: `${actorName} hat ein Review gepostet`,
      body: title.trim() || workSummary || "Neue Episoden-Reviews im Feed.",
      link: "/",
      icon: firstItem?.work_cover,
      workId: firstItem?.work_id,
    }),
  }).catch(console.error);

  return newActivity;
}

/**
 * Updates an existing REVIEW_LIST activity (verifying ownership) and syncs all
 * linked episode_feedback documents.
 */
export async function updateReviewList(
  activityId: string,
  userId: string,
  newTitle: string,
  newItems: ReviewListItem[]
): Promise<ActivityFeed | null> {
  if (!db) return null;

  const activityRef = doc(db, "activity_feed", activityId);
  const snap = await getDoc(activityRef);
  if (!snap.exists()) return null;

  const data = snap.data() as ActivityFeed;
  if (data.user_id !== userId) {
    throw new Error("Nicht berechtigt, diese Review-Liste zu bearbeiten.");
  }

  const sanitizedItems = newItems.map(sanitizeReviewItem);
  const work_ids = Array.from(new Set(sanitizedItems.map((i) => i.work_id)));

  await updateDoc(activityRef, {
    text: newTitle,
    review_items: sanitizedItems,
    work_ids,
  });

  // Replace linked episode_feedback documents for this activity_id
  const feedbackCol = collection(db, "episode_feedback");
  const q = query(feedbackCol, where("activity_id", "==", activityId));
  const oldFbSnap = await getDocs(q);
  await Promise.all(oldFbSnap.docs.map((d) => deleteDoc(d.ref)));

  const timestamp = data.timestamp || new Date().toISOString();
  await Promise.all(
    sanitizedItems.map((item) => {
      const fbRef = doc(feedbackCol);
      const feedbackDoc: EpisodeFeedback = {
        feedback_id: fbRef.id,
        user_id: userId,
        work_id: item.work_id,
        episode_num: item.episode_num,
        media_type: item.media_type,
        text: item.text,
        activity_id: activityId,
        timestamp,
        reactions: {},
      };
      if (typeof item.rating === "number") {
        feedbackDoc.rating = item.rating;
      }
      return setDoc(fbRef, feedbackDoc);
    })
  );

  return {
    ...data,
    text: newTitle,
    review_items: sanitizedItems,
    work_ids,
  };
}

/**
 * Adds a single episode/chapter feedback entry (with optional 1-10 rating)
 * directly from a work's detail page.
 */
export async function addSingleEpisodeFeedback(
  userId: string,
  item: ReviewListItem
): Promise<EpisodeFeedback | null> {
  if (!db) return null;

  const feedbackCol = collection(db, "episode_feedback");
  const fbRef = doc(feedbackCol);
  const timestamp = new Date().toISOString();

  const feedbackDoc: EpisodeFeedback = {
    feedback_id: fbRef.id,
    user_id: userId,
    work_id: item.work_id,
    episode_num: item.episode_num,
    media_type: item.media_type,
    text: item.text,
    timestamp,
    reactions: {},
  };
  if (typeof item.rating === "number" && !Number.isNaN(item.rating)) {
    feedbackDoc.rating = item.rating;
  }

  await setDoc(fbRef, feedbackDoc);
  return feedbackDoc;
}

/**
 * Fetches recent episode_feedback entries globally so the review feed can
 * compare ratings/reviews on the exact same work and episode/chapter.
 */
export async function getAllEpisodeFeedback(
  limitCount: number = 300
): Promise<EpisodeFeedback[]> {
  if (!db) return [];

  try {
    const feedbackCol = collection(db, "episode_feedback");
    const q = query(feedbackCol, orderBy("timestamp", "desc"), limit(limitCount));
    const snapshot = await getDocs(q);

    const items: EpisodeFeedback[] = [];
    snapshot.forEach((docSnap) => {
      items.push(docSnap.data() as EpisodeFeedback);
    });
    return items;
  } catch (err) {
    console.error("Failed to fetch global episode feedback:", err);
    return [];
  }
}

/**
 * Fetches all episode feedback entries for a given work,
 * sorted by episode_num descending, then timestamp descending.
 */
export async function getEpisodeFeedbackForWork(
  workId: string
): Promise<EpisodeFeedback[]> {
  if (!db) return [];

  const feedbackCol = collection(db, "episode_feedback");
  const q = query(feedbackCol, where("work_id", "==", workId));
  const snapshot = await getDocs(q);

  const items: EpisodeFeedback[] = [];
  snapshot.forEach((docSnap) => {
    items.push(docSnap.data() as EpisodeFeedback);
  });

  return items.sort(sortFeedbackDesc);
}

/**
 * Fetches a user's episode feedback entries and computes their average
 * 1-10 episode rating for a given work.
 */
export async function getUserEpisodeRatingsForWork(
  userId: string,
  workId: string
): Promise<{ average: number | null; count: number; items: EpisodeFeedback[] }> {
  if (!db) return { average: null, count: 0, items: [] };

  const allForWork = await getEpisodeFeedbackForWork(workId);
  const userItems = allForWork.filter((item) => item.user_id === userId);

  const ratedItems = userItems.filter(
    (item) => typeof item.rating === "number" && !Number.isNaN(item.rating)
  );

  if (ratedItems.length === 0) {
    return { average: null, count: 0, items: userItems };
  }

  const total = ratedItems.reduce((sum, item) => sum + (item.rating as number), 0);
  const average = total / ratedItems.length;

  return {
    average,
    count: ratedItems.length,
    items: userItems,
  };
}

/**
 * Toggles a user's emoji reaction on an activity_feed document and returns
 * the updated reactions map.
 */
export async function toggleActivityReaction(
  activityId: string,
  userId: string,
  emoji: string
): Promise<Record<string, string[]>> {
  if (!db) return {};

  const activityRef = doc(db, "activity_feed", activityId);
  const snap = await getDoc(activityRef);
  if (!snap.exists()) return {};

  const data = snap.data() as ActivityFeed;
  const reactions: Record<string, string[]> = { ...(data.reactions || {}) };
  const currentUsers = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];

  if (currentUsers.includes(userId)) {
    const filtered = currentUsers.filter((uid) => uid !== userId);
    if (filtered.length === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = filtered;
    }
  } else {
    reactions[emoji] = [...currentUsers, userId];
  }

  await updateDoc(activityRef, { reactions });
  return reactions;
}

/**
 * Deletes a REVIEW_LIST activity (verifying ownership), deletes all linked
 * episode_feedback documents, and returns the deleted review_items so the caller
 * can roll back the user's episode/chapter progress.
 */
export async function deleteReviewList(
  activityId: string,
  userId: string
): Promise<ReviewListItem[]> {
  if (!db) return [];

  const activityRef = doc(db, "activity_feed", activityId);
  const snap = await getDoc(activityRef);
  if (!snap.exists()) return [];

  const data = snap.data() as ActivityFeed;
  if (data.user_id !== userId) {
    throw new Error("Nicht berechtigt, diese Review-Liste zu löschen.");
  }

  const deletedItems = Array.isArray(data.review_items) ? data.review_items : [];

  await deleteDoc(activityRef);

  const feedbackCol = collection(db, "episode_feedback");
  const q = query(feedbackCol, where("activity_id", "==", activityId));
  const fbSnap = await getDocs(q);

  await Promise.all(fbSnap.docs.map((d) => deleteDoc(d.ref)));

  return deletedItems;
}


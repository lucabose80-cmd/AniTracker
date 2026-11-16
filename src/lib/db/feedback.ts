import { db } from "@/lib/firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { ActivityFeed, EpisodeFeedback, ReviewListItem } from "@/types/database";
import { getUserProfile } from "@/lib/db/users";

function sanitizeReviewItem(item: ReviewListItem): ReviewListItem {
  const sanitized: ReviewListItem = {
    work_id: item.work_id,
    work_title: item.work_title,
    media_type: item.media_type,
    episode_num: item.episode_num,
    text: item.text,
  };
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
  try {
    const profile = await getUserProfile(userId);
    if (profile?.username) {
      actorName = profile.username;
    }
  } catch (e) {
    console.error("Failed to fetch actor profile for notification:", e);
  }

  const workSummary = sanitizedItems
    .map((i) => i.work_title)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUserId: "ALL",
      excludeUserId: userId,
      type: "social",
      title: `${actorName} hat eine Review-Liste gepostet`,
      body: title.trim() || workSummary || "Neue Episoden-Reviews im Feed.",
      link: "/",
    }),
  }).catch(console.error);

  return newActivity;
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
 * Deletes a REVIEW_LIST activity (verifying ownership) and all linked
 * episode_feedback documents.
 */
export async function deleteReviewList(
  activityId: string,
  userId: string
): Promise<void> {
  if (!db) return;

  const activityRef = doc(db, "activity_feed", activityId);
  const snap = await getDoc(activityRef);
  if (!snap.exists()) return;

  const data = snap.data() as ActivityFeed;
  if (data.user_id !== userId) {
    throw new Error("Nicht berechtigt, diese Review-Liste zu löschen.");
  }

  await deleteDoc(activityRef);

  const feedbackCol = collection(db, "episode_feedback");
  const q = query(feedbackCol, where("activity_id", "==", activityId));
  const fbSnap = await getDocs(q);

  await Promise.all(fbSnap.docs.map((d) => deleteDoc(d.ref)));
}

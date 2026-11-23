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
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  ActivityFeed,
  EpisodeFeedback,
  InAppNotification,
  ReviewListItem,
} from "@/types/database";
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

function formatReviewItemEpLabel(item: ReviewListItem): string {
  const unit = item.media_type === "MANGA" ? "Kap." : "Folge";
  if (
    typeof item.episode_end === "number" &&
    !Number.isNaN(item.episode_end) &&
    item.episode_end > item.episode_num
  ) {
    return `${unit} ${item.episode_num}–${item.episode_end}`;
  }
  if (Array.isArray(item.episodes) && item.episodes.length > 1) {
    const sorted = [...item.episodes].sort((a, b) => a - b);
    return `${unit} ${sorted.join(", ")}`;
  }
  return `${unit} ${item.episode_num}`;
}

function getReviewItemEpisodeKey(item: ReviewListItem): string {
  const eps = Array.isArray(item.episodes)
    ? [...item.episodes].sort((a, b) => a - b).join(",")
    : "";
  const end =
    typeof item.episode_end === "number" && item.episode_end > item.episode_num
      ? item.episode_end
      : "";
  return `${item.episode_num}|${end}|${eps}`;
}

function areReviewItemsEqual(a: ReviewListItem, b: ReviewListItem): boolean {
  return (
    a.work_id === b.work_id &&
    getReviewItemEpisodeKey(a) === getReviewItemEpisodeKey(b) &&
    (a.rating ?? null) === (b.rating ?? null) &&
    (a.text || "").trim() === (b.text || "").trim()
  );
}

function buildFeedbackDoc(
  feedbackId: string,
  userId: string,
  item: ReviewListItem,
  timestamp: string,
  activityId?: string,
  existingReactions?: Record<string, string[]>
): EpisodeFeedback {
  const feedbackDoc: EpisodeFeedback = {
    feedback_id: feedbackId,
    user_id: userId,
    work_id: item.work_id,
    episode_num: item.episode_num,
    media_type: item.media_type,
    text: (item.text || "").slice(0, 2000),
    timestamp,
    reactions: existingReactions || {},
  };
  if (activityId) {
    feedbackDoc.activity_id = activityId;
  }
  if (
    typeof item.episode_end === "number" &&
    !Number.isNaN(item.episode_end) &&
    item.episode_end > item.episode_num
  ) {
    feedbackDoc.episode_end = item.episode_end;
  }
  if (Array.isArray(item.episodes) && item.episodes.length > 0) {
    feedbackDoc.episodes = item.episodes;
  }
  if (typeof item.rating === "number" && !Number.isNaN(item.rating)) {
    feedbackDoc.rating = item.rating;
  }
  return feedbackDoc;
}

interface ReviewUpdateAnalysis {
  hasChanges: boolean;
  addedItems: ReviewListItem[];
  modifiedItems: Array<{
    item: ReviewListItem;
    episodesChanged: boolean;
    ratingChanged: boolean;
    textChanged: boolean;
  }>;
  removedCount: number;
  titleChanged: boolean;
  highlightItem?: ReviewListItem;
}

function analyzeReviewListUpdate(
  oldTitle: string,
  oldItems: ReviewListItem[],
  newTitle: string,
  newItems: ReviewListItem[]
): ReviewUpdateAnalysis {
  const usedOldIndices = new Set<number>();
  const unmatchedNew: ReviewListItem[] = [];

  for (const newItem of newItems) {
    const exactIdx = oldItems.findIndex(
      (oldItem, idx) => !usedOldIndices.has(idx) && areReviewItemsEqual(oldItem, newItem)
    );
    if (exactIdx !== -1) {
      usedOldIndices.add(exactIdx);
    } else {
      unmatchedNew.push(newItem);
    }
  }

  const addedItems: ReviewListItem[] = [];
  const modifiedItems: ReviewUpdateAnalysis["modifiedItems"] = [];

  for (const newItem of unmatchedNew) {
    const sameWorkIdx = oldItems.findIndex(
      (oldItem, idx) => !usedOldIndices.has(idx) && oldItem.work_id === newItem.work_id
    );
    if (sameWorkIdx !== -1) {
      usedOldIndices.add(sameWorkIdx);
      const prevItem = oldItems[sameWorkIdx];
      modifiedItems.push({
        item: newItem,
        episodesChanged:
          getReviewItemEpisodeKey(prevItem) !== getReviewItemEpisodeKey(newItem),
        ratingChanged: (prevItem.rating ?? null) !== (newItem.rating ?? null),
        textChanged: (prevItem.text || "").trim() !== (newItem.text || "").trim(),
      });
    } else {
      addedItems.push(newItem);
    }
  }

  const removedCount = Math.max(0, oldItems.length - usedOldIndices.size);
  const titleChanged = oldTitle.trim() !== newTitle.trim();
  const hasChanges =
    addedItems.length > 0 ||
    modifiedItems.length > 0 ||
    removedCount > 0 ||
    titleChanged;

  const highlightItem =
    addedItems[0] ||
    modifiedItems.find((m) => m.episodesChanged)?.item ||
    modifiedItems.find((m) => m.ratingChanged)?.item ||
    modifiedItems[0]?.item ||
    newItems[0];

  return {
    hasChanges,
    addedItems,
    modifiedItems,
    removedCount,
    titleChanged,
    highlightItem,
  };
}

async function notifyOtherUsersAboutReview(params: {
  userId: string;
  activityId?: string;
  notifType: InAppNotification["type"];
  pushTitle: (actorName: string) => string;
  bodyText: string;
  link?: string;
  highlightItem?: ReviewListItem;
  timestamp: string;
}) {
  if (!db) return;

  let actorName = "Jemand";
  let actorAvatar = "";
  try {
    const profile = await getUserProfile(params.userId);
    if (profile?.username) actorName = profile.username;
    if (profile?.avatar_url) actorAvatar = profile.avatar_url;
  } catch (e) {
    console.error("Failed to fetch actor profile for notification:", e);
  }

  const highlight = params.highlightItem;

  try {
    const usersSnap = await getDocs(collection(db, "users"));
    const notifCol = collection(db, "notifications");
    await Promise.all(
      usersSnap.docs
        .filter((uDoc) => uDoc.id !== params.userId)
        .map((uDoc) => {
          const notifRef = doc(notifCol);
          const payload: Record<string, unknown> = {
            notification_id: notifRef.id,
            user_id: uDoc.id,
            actor_id: params.userId,
            actor_name: actorName.slice(0, 100),
            actor_avatar: actorAvatar,
            type: params.notifType,
            text: params.bodyText.slice(0, 1000),
            timestamp: params.timestamp,
            read: false,
          };
          if (params.activityId) payload.activity_id = params.activityId;
          if (highlight?.work_id) payload.work_id = highlight.work_id;
          if (highlight?.work_title) {
            payload.work_title = highlight.work_title.slice(0, 200);
          }
          if (highlight?.media_type) payload.media_type = highlight.media_type;
          if (typeof highlight?.episode_num === "number") {
            payload.episode_num = getReviewItemTargetEpisode(highlight);
          }
          return setDoc(notifRef, payload);
        })
    );
  } catch (e) {
    console.warn("Could not create in-app notifications for review:", e);
  }

  fetch("/api/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetUserId: "ALL",
      excludeUserId: params.userId,
      type: "social",
      title: params.pushTitle(actorName),
      body: params.bodyText,
      link:
        params.link ||
        (params.activityId ? `/?activity_id=${params.activityId}` : "/"),
      icon: highlight?.work_cover,
      workId: highlight?.work_id,
    }),
  }).catch(console.error);
}

/**
 * Creates a REVIEW_LIST activity feed post and individual episode_feedback
 * documents atomically via writeBatch so ratings/notes are queryable per work and episode.
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

  const batch = writeBatch(db);
  batch.set(newActivityRef, newActivity);

  const feedbackCol = collection(db, "episode_feedback");
  sanitizedItems.forEach((item) => {
    const fbRef = doc(feedbackCol);
    batch.set(fbRef, buildFeedbackDoc(fbRef.id, userId, item, timestamp, activity_id));
  });

  await batch.commit();

  const workSummary = sanitizedItems
    .map((i) => i.work_title)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");

  const firstItem = sanitizedItems[0];
  const bodyText =
    title.trim() ||
    (workSummary
      ? `Neues Review zu ${workSummary}`
      : "Neue Episoden-Reviews im Feed.");

  await notifyOtherUsersAboutReview({
    userId,
    activityId: activity_id,
    notifType: "REVIEW_POST",
    pushTitle: (actorName) => `${actorName} hat ein Review gepostet`,
    bodyText,
    link: `/?activity_id=${activity_id}`,
    highlightItem: firstItem,
    timestamp,
  });

  return newActivity;
}

/**
 * Updates an existing REVIEW_LIST activity atomically, preserves reactions on
 * matching episode_feedback docs, and notifies other users on meaningful changes.
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

  const oldTitle = data.text || "";
  const oldItems = Array.isArray(data.review_items) ? data.review_items : [];
  const sanitizedItems = newItems.map(sanitizeReviewItem);
  const work_ids = Array.from(new Set(sanitizedItems.map((i) => i.work_id)));

  const feedbackCol = collection(db, "episode_feedback");
  const oldFbSnap = await getDocs(
    query(feedbackCol, where("activity_id", "==", activityId))
  );

  // Preserve reactions by work_id + episode_num when replacing feedback entries
  const oldReactionsByKey = new Map<string, Record<string, string[]>>();
  oldFbSnap.docs.forEach((d) => {
    const fb = d.data() as EpisodeFeedback;
    if (fb.reactions && Object.keys(fb.reactions).length > 0) {
      oldReactionsByKey.set(`${fb.work_id}_${fb.episode_num}`, fb.reactions);
      if (!oldReactionsByKey.has(fb.work_id)) {
        oldReactionsByKey.set(fb.work_id, fb.reactions);
      }
    }
  });

  const batch = writeBatch(db);
  batch.update(activityRef, {
    text: newTitle,
    review_items: sanitizedItems,
    work_ids,
  });

  oldFbSnap.docs.forEach((d) => batch.delete(d.ref));

  const timestamp = data.timestamp || new Date().toISOString();
  sanitizedItems.forEach((item) => {
    const fbRef = doc(feedbackCol);
    const preserved =
      oldReactionsByKey.get(`${item.work_id}_${item.episode_num}`) ||
      oldReactionsByKey.get(item.work_id);
    batch.set(
      fbRef,
      buildFeedbackDoc(fbRef.id, userId, item, timestamp, activityId, preserved)
    );
  });

  await batch.commit();

  const analysis = analyzeReviewListUpdate(
    oldTitle,
    oldItems,
    newTitle,
    sanitizedItems
  );
  if (analysis.hasChanges) {
    const addedSummaries = analysis.addedItems.map((item) => {
      const epLabel = formatReviewItemEpLabel(item);
      const ratingPart =
        typeof item.rating === "number" ? ` · ★ ${item.rating}` : "";
      return `${item.work_title} (${epLabel}${ratingPart})`;
    });

    const modifiedSummaries = analysis.modifiedItems.map((m) => {
      const epLabel = formatReviewItemEpLabel(m.item);
      if (m.episodesChanged) {
        const ratingPart =
          typeof m.item.rating === "number" ? ` · ★ ${m.item.rating}` : "";
        return `${m.item.work_title} (${epLabel}${ratingPart})`;
      }
      if (m.ratingChanged) {
        const ratingPart =
          typeof m.item.rating === "number"
            ? `★ ${m.item.rating}/10`
            : "Bewertung entfernt";
        return `${m.item.work_title} (${epLabel} · ${ratingPart})`;
      }
      return `${m.item.work_title} (${epLabel} bearbeitet)`;
    });

    const combinedSummaries = [...addedSummaries, ...modifiedSummaries];
    let bodyText = "";
    if (addedSummaries.length > 0 && modifiedSummaries.length === 0) {
      const extra =
        addedSummaries.length > 2 ? ` (+${addedSummaries.length - 2})` : "";
      bodyText = `Neu im Review: ${addedSummaries.slice(0, 2).join(", ")}${extra}`;
    } else if (addedSummaries.length > 0) {
      const extra =
        combinedSummaries.length > 2
          ? ` (+${combinedSummaries.length - 2})`
          : "";
      bodyText = `Review ergänzt: ${combinedSummaries.slice(0, 2).join(", ")}${extra}`;
    } else if (modifiedSummaries.length > 0) {
      const extra =
        modifiedSummaries.length > 2
          ? ` (+${modifiedSummaries.length - 2})`
          : "";
      bodyText = `Review angepasst: ${modifiedSummaries.slice(0, 2).join(", ")}${extra}`;
    } else {
      bodyText = newTitle.trim() || "Ein Review wurde aktualisiert.";
    }

    const hasNewEpisodesOrItems =
      analysis.addedItems.length > 0 ||
      analysis.modifiedItems.some((m) => m.episodesChanged);
    const hasRatingChange = analysis.modifiedItems.some((m) => m.ratingChanged);

    await notifyOtherUsersAboutReview({
      userId,
      activityId,
      notifType: "REVIEW_UPDATE",
      pushTitle: (actorName) =>
        hasNewEpisodesOrItems
          ? `${actorName} hat ein Review ergänzt`
          : hasRatingChange
          ? `${actorName} hat eine Bewertung angepasst`
          : `${actorName} hat ein Review aktualisiert`,
      bodyText,
      link: `/?activity_id=${activityId}`,
      highlightItem: analysis.highlightItem,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    ...data,
    text: newTitle,
    review_items: sanitizedItems,
    work_ids,
  };
}

/**
 * Adds a single episode/chapter feedback entry directly from a work's detail page.
 */
export async function addSingleEpisodeFeedback(
  userId: string,
  item: ReviewListItem
): Promise<EpisodeFeedback | null> {
  if (!db) return null;

  const feedbackCol = collection(db, "episode_feedback");
  const fbRef = doc(feedbackCol);
  const timestamp = new Date().toISOString();

  const feedbackDoc = buildFeedbackDoc(fbRef.id, userId, item, timestamp);
  await setDoc(fbRef, feedbackDoc);

  const epLabel = formatReviewItemEpLabel(item);
  const ratingPart =
    typeof feedbackDoc.rating === "number" ? ` · ★ ${feedbackDoc.rating}/10` : "";
  await notifyOtherUsersAboutReview({
    userId,
    notifType: "REVIEW_POST",
    pushTitle: (actorName) => `${actorName} hat ein Feedback gepostet`,
    bodyText: `${item.work_title} (${epLabel}${ratingPart}): ${item.text.slice(0, 100)}`,
    link: `/work/${item.work_id}`,
    highlightItem: item,
    timestamp,
  });

  return feedbackDoc;
}

/**
 * Deletes a standalone episode_feedback document owned by userId.
 */
export async function deleteSingleEpisodeFeedback(
  feedbackId: string,
  userId: string
): Promise<void> {
  if (!db || !feedbackId || !userId) return;
  const fbRef = doc(db, "episode_feedback", feedbackId);
  const snap = await getDoc(fbRef);
  if (!snap.exists()) return;
  const data = snap.data() as EpisodeFeedback;
  if (data.user_id !== userId) {
    throw new Error("Nicht berechtigt, dieses Feedback zu löschen.");
  }
  await deleteDoc(fbRef);
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
 * Atomically toggles a user's emoji reaction on an activity_feed document using a transaction.
 */
export async function toggleActivityReaction(
  activityId: string,
  userId: string,
  emoji: string
): Promise<Record<string, string[]>> {
  if (!db) return {};

  const activityRef = doc(db, "activity_feed", activityId);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(activityRef);
      if (!snap.exists()) return {};

      const data = snap.data() as ActivityFeed;
      const reactions: Record<string, string[]> = { ...(data.reactions || {}) };
      const currentUsers = Array.isArray(reactions[emoji])
        ? [...reactions[emoji]]
        : [];

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

      tx.update(activityRef, { reactions });
      return reactions;
    });
  } catch {
    // Fallback to standard update if offline/transaction unavailable
    const snap = await getDoc(activityRef);
    if (!snap.exists()) return {};
    const data = snap.data() as ActivityFeed;
    const reactions: Record<string, string[]> = { ...(data.reactions || {}) };
    const currentUsers = Array.isArray(reactions[emoji])
      ? [...reactions[emoji]]
      : [];
    if (currentUsers.includes(userId)) {
      const filtered = currentUsers.filter((uid) => uid !== userId);
      if (filtered.length === 0) delete reactions[emoji];
      else reactions[emoji] = filtered;
    } else {
      reactions[emoji] = [...currentUsers, userId];
    }
    await updateDoc(activityRef, { reactions });
    return reactions;
  }
}

/**
 * Deletes a REVIEW_LIST activity (verifying ownership) and all linked
 * episode_feedback documents atomically, returning the deleted review_items.
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

  const feedbackCol = collection(db, "episode_feedback");
  const fbSnap = await getDocs(
    query(feedbackCol, where("activity_id", "==", activityId))
  );

  const batch = writeBatch(db);
  batch.delete(activityRef);
  fbSnap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();

  return deletedItems;
}

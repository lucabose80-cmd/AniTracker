"use client";

import { useAppStore } from "@/lib/store";
import {
  LogIn,
  Search,
  Bell,
  X,
  Sparkles,
  CheckCheck,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { getUserProfile, getAllUserProfiles } from "@/lib/db/users";
import {
  getInAppNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
  dismissCommunityActivity,
  clearBellItems,
  getGlobalFeed,
} from "@/lib/db/feed";
import {
  ActivityFeed,
  InAppNotification,
  UserProfile,
} from "@/types/database";
import { AniListMedia, getAniListTitle } from "@/types/anilist";
import { fetchAniListBatch } from "@/lib/anilist";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { PWAInstallPrompt } from "@/components/ui/PWAInstallPrompt";

const isReleaseNotification = (n: InAppNotification) =>
  n.type === "SYSTEM" || n.type === "APP_UPDATE";

function getNotificationBadge(type: string): {
  label: string;
  className: string;
} {
  switch (type) {
    case "SYSTEM":
      return {
        label: "Release",
        className:
          "bg-accent-soft text-accent-light border-accent-border",
      };
    case "APP_UPDATE":
      return {
        label: "App-Update",
        className: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      };
    case "REVIEW_POST":
    case "REVIEW_UPDATE":
      return {
        label: "Review",
        className:
          "bg-accent-soft text-accent-light border-accent-border",
      };
    case "RATING_UPDATE":
      return {
        label: "Bewertung",
        className: "bg-amber-500/20 text-amber-300 border-amber-500/30",
      };
    case "COMMENT_ON_REVIEW":
    case "REPLY_TO_COMMENT":
      return {
        label: "Kommentar",
        className: "bg-purple-500/20 text-purple-300 border-purple-500/30",
      };
    default:
      return {
        label: "Info",
        className:
          "bg-accent-soft text-accent-light border-accent-border",
      };
  }
}

export function Header() {
  const router = useRouter();
  const {
    contentType,
    toggleContentType,
    unreadNotifications,
    setUnreadNotifications,
    reloadTrigger,
  } = useAppStore();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Bell panel state
  const [showBellPanel, setShowBellPanel] = useState(false);
  const [bellTab, setBellTab] = useState<"ALL" | "RELEASES" | "COMMUNITY">(
    "ALL"
  );
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [communityUpdates, setCommunityUpdates] = useState<ActivityFeed[]>([]);
  const [dismissedActivityIds, setDismissedActivityIds] = useState<Set<string>>(
    new Set()
  );
  const [dismissedActivitiesBefore, setDismissedActivitiesBefore] =
    useState<number>(0);
  const [deletedNotificationIds, setDeletedNotificationIds] = useState<
    Set<string>
  >(new Set());
  const [actorProfiles, setActorProfiles] = useState<
    Record<string, UserProfile>
  >({});
  const [workDetailsMap, setWorkDetailsMap] = useState<
    Record<string, AniListMedia>
  >({});
  const [seenActivityTimestamp, setSeenActivityTimestamp] = useState<number>(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Refs to prevent stale closures and async race overwrites
  const dismissedActivityIdsRef = useRef<Set<string>>(new Set());
  const dismissedBeforeRef = useRef<number>(0);
  const deletedNotifIdsRef = useRef<Set<string>>(new Set());
  const workDetailsRef = useRef<Record<string, AniListMedia>>({});

  const getLocalKeys = (uid: string) => ({
    activities: `anipulse_dismissed_activities_${uid}`,
    before: `anipulse_dismissed_before_${uid}`,
    notifs: `anipulse_deleted_notifs_${uid}`,
  });

  const persistDismissedIds = useCallback((uid: string, nextSet: Set<string>) => {
    dismissedActivityIdsRef.current = nextSet;
    setDismissedActivityIds(nextSet);
    try {
      const serialized = JSON.stringify(Array.from(nextSet).slice(-500));
      window.localStorage.setItem(getLocalKeys(uid).activities, serialized);
    } catch {
      // ignore
    }
  }, []);

  const persistDismissedBefore = useCallback((uid: string, tsMs: number) => {
    const nextTs = Math.max(dismissedBeforeRef.current, tsMs);
    dismissedBeforeRef.current = nextTs;
    setDismissedActivitiesBefore(nextTs);
    try {
      window.localStorage.setItem(getLocalKeys(uid).before, String(nextTs));
    } catch {
      // ignore
    }
  }, []);

  const persistDeletedNotifIds = useCallback((uid: string, nextSet: Set<string>) => {
    deletedNotifIdsRef.current = nextSet;
    setDeletedNotificationIds(nextSet);
    try {
      const serialized = JSON.stringify(Array.from(nextSet).slice(-500));
      window.localStorage.setItem(getLocalKeys(uid).notifs, serialized);
    } catch {
      // ignore
    }
  }, []);

  const hydrateLocalDismissals = useCallback((uid: string) => {
    const keys = getLocalKeys(uid);
    const nextActivities = new Set<string>(dismissedActivityIdsRef.current);
    const nextNotifs = new Set<string>(deletedNotifIdsRef.current);
    let nextBefore = dismissedBeforeRef.current;

    try {
      const legacyDismissed = window.localStorage.getItem(
        "anipulse_dismissed_activities"
      );
      if (legacyDismissed) {
        const parsed = JSON.parse(legacyDismissed);
        if (Array.isArray(parsed)) {
          parsed.forEach((id) => {
            if (typeof id === "string") nextActivities.add(id);
          });
        }
      }

      const savedActivities = window.localStorage.getItem(keys.activities);
      if (savedActivities) {
        const parsed = JSON.parse(savedActivities);
        if (Array.isArray(parsed)) {
          parsed.forEach((id) => {
            if (typeof id === "string") nextActivities.add(id);
          });
        }
      }

      const savedNotifs = window.localStorage.getItem(keys.notifs);
      if (savedNotifs) {
        const parsed = JSON.parse(savedNotifs);
        if (Array.isArray(parsed)) {
          parsed.forEach((id) => {
            if (typeof id === "string") nextNotifs.add(id);
          });
        }
      }

      const savedBefore = Number(window.localStorage.getItem(keys.before) || "0");
      if (!Number.isNaN(savedBefore) && savedBefore > nextBefore) {
        nextBefore = savedBefore;
      }
    } catch {
      // ignore localStorage issues
    }

    dismissedActivityIdsRef.current = nextActivities;
    deletedNotifIdsRef.current = nextNotifs;
    dismissedBeforeRef.current = nextBefore;
    setDismissedActivityIds(nextActivities);
    setDeletedNotificationIds(nextNotifs);
    setDismissedActivitiesBefore(nextBefore);

    try {
      const savedTs = Number(
        window.localStorage.getItem("anipulse_seen_updates_ts") || "0"
      );
      if (!Number.isNaN(savedTs) && savedTs > 0) {
        setSeenActivityTimestamp(savedTs);
      }
    } catch {
      // ignore localStorage issues
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowBellPanel(false);
      }
    };
    if (showBellPanel) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showBellPanel]);

  const loadBellData = useCallback(
    async (uid: string, preloadedProfile?: UserProfile | null) => {
      try {
        const [notifs, feedItems, allUsers, freshProfile] = await Promise.all([
          getInAppNotifications(uid).catch(() => []),
          getGlobalFeed(40).catch(() => []),
          getAllUserProfiles().catch(() => []),
          preloadedProfile !== undefined
            ? Promise.resolve(preloadedProfile)
            : getUserProfile(uid).catch(() => null),
        ]);

        // Merge Firestore-persisted dismissed activities with local state
        if (freshProfile) {
          setProfile(freshProfile);
          if (Array.isArray(freshProfile.dismissed_activity_ids)) {
            const mergedActivities = new Set(dismissedActivityIdsRef.current);
            freshProfile.dismissed_activity_ids.forEach((id) => {
              if (typeof id === "string") mergedActivities.add(id);
            });
            persistDismissedIds(uid, mergedActivities);
          }
          if (freshProfile.dismissed_activities_before) {
            const parsedBefore = Date.parse(
              freshProfile.dismissed_activities_before
            );
            if (!Number.isNaN(parsedBefore) && parsedBefore > 0) {
              persistDismissedBefore(uid, parsedBefore);
            }
          }
        }

        const cleanNotifs = notifs.filter(
          (n) =>
            !n.deleted &&
            !deletedNotifIdsRef.current.has(n.notification_id) &&
            n.type !== "NEW_EPISODE_THREAD" &&
            n.type !== "COMMENT_ON_THREAD"
        );
        setNotifications(cleanNotifs);
        const unreadNotifCount = cleanNotifs.filter((n) => !n.read).length;
        setUnreadNotifications(unreadNotifCount);

        // Non-review community updates (Watchlist/Library additions, manual posts)
        const updates = feedItems.filter(
          (a) =>
            a.action_type !== "REVIEW_LIST" &&
            a.action_type !== "RATING" &&
            a.action_type !== "EPISODE_THREAD" &&
            a.action_type !== "WEEKLY_RANKING"
        );
        setCommunityUpdates(updates);

        if (allUsers.length > 0) {
          const profilesMap: Record<string, UserProfile> = {};
          allUsers.forEach((p) => {
            if (p.uid) profilesMap[p.uid] = p;
          });
          setActorProfiles((prev) => ({ ...prev, ...profilesMap }));
        }

        // Load missing AniList work titles/covers
        const workIds = new Set<number>();
        cleanNotifs.forEach((n) => {
          if (n.work_id) {
            const parsed = parseInt(n.work_id, 10);
            if (!Number.isNaN(parsed)) workIds.add(parsed);
          }
        });
        updates.forEach((a) => {
          if (a.work_id) {
            const parsed = parseInt(a.work_id, 10);
            if (!Number.isNaN(parsed)) workIds.add(parsed);
          }
        });

        const missingIds = Array.from(workIds).filter(
          (id) => !workDetailsRef.current[id.toString()]
        );
        if (missingIds.length > 0) {
          const mediaList = await fetchAniListBatch(missingIds);
          const newMap: Record<string, AniListMedia> = {};
          mediaList.forEach((m) => {
            newMap[m.id.toString()] = m;
          });
          workDetailsRef.current = { ...workDetailsRef.current, ...newMap };
          setWorkDetailsMap((prev) => ({ ...prev, ...newMap }));
        }
      } catch (err) {
        console.error("Failed to load bell data:", err);
      }
    },
    [persistDismissedBefore, persistDismissedIds, setUnreadNotifications]
  );

  // Register auth listener ONCE
  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        hydrateLocalDismissals(currentUser.uid);
        const p = await getUserProfile(currentUser.uid);
        setProfile(p);
        loadBellData(currentUser.uid, p);
      } else {
        setProfile(null);
        setNotifications([]);
        setCommunityUpdates([]);
        dismissedActivityIdsRef.current = new Set();
        deletedNotifIdsRef.current = new Set();
        dismissedBeforeRef.current = 0;
        setDismissedActivityIds(new Set());
        setDeletedNotificationIds(new Set());
        setDismissedActivitiesBefore(0);
      }
    });
    return () => unsubscribe();
  }, [hydrateLocalDismissals, loadBellData]);

  // Light refresh when reloadTrigger increments
  useEffect(() => {
    if (reloadTrigger <= 0 || !user) return;
    const timer = window.setTimeout(() => {
      loadBellData(user.uid);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reloadTrigger, user, loadBellData]);

  const handleToggleBellPanel = () => {
    const nextOpen = !showBellPanel;
    setShowBellPanel(nextOpen);
    if (nextOpen && user) {
      loadBellData(user.uid);
      const now = Date.now();
      setSeenActivityTimestamp(now);
      try {
        window.localStorage.setItem("anipulse_seen_updates_ts", String(now));
      } catch {
        // ignore
      }
    }
  };

  const visibleNotifications = useMemo(
    () =>
      notifications.filter(
        (n) => !n.deleted && !deletedNotificationIds.has(n.notification_id)
      ),
    [notifications, deletedNotificationIds]
  );

  const visibleCommunityUpdates = useMemo(
    () =>
      communityUpdates.filter((a) => {
        if (dismissedActivityIds.has(a.activity_id)) return false;
        if (dismissedActivitiesBefore > 0) {
          const ts = new Date(a.timestamp).getTime();
          if (!Number.isNaN(ts) && ts <= dismissedActivitiesBefore) {
            return false;
          }
        }
        return true;
      }),
    [communityUpdates, dismissedActivityIds, dismissedActivitiesBefore]
  );

  const unreadNotifCount = useMemo(
    () => visibleNotifications.filter((n) => !n.read).length,
    [visibleNotifications]
  );

  const unseenCommunityCount = useMemo(() => {
    if (!user) return 0;
    return visibleCommunityUpdates.filter((a) => {
      if (a.user_id === user.uid) return false;
      const ts = new Date(a.timestamp).getTime();
      return ts > seenActivityTimestamp;
    }).length;
  }, [visibleCommunityUpdates, seenActivityTimestamp, user]);

  // Combine realtime Firestore unread badge from ServiceWorkerManager with local bell counts
  const totalBadgeCount =
    Math.max(unreadNotifCount, unreadNotifications) + unseenCommunityCount;

  const handleMarkAllRead = async () => {
    if (!user) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadNotifications(0);
    const now = Date.now();
    setSeenActivityTimestamp(now);
    try {
      window.localStorage.setItem("anipulse_seen_updates_ts", String(now));
    } catch {
      // ignore
    }
    await markAllNotificationsRead(user.uid);
  };

  const handleDeleteSingleNotification = async (
    e: React.MouseEvent,
    notif: InAppNotification
  ) => {
    e.stopPropagation();
    if (user) {
      const nextDeleted = new Set(deletedNotifIdsRef.current);
      nextDeleted.add(notif.notification_id);
      persistDeletedNotifIds(user.uid, nextDeleted);
    }
    setNotifications((prev) =>
      prev.filter((n) => n.notification_id !== notif.notification_id)
    );
    if (!notif.read) {
      setUnreadNotifications(Math.max(0, unreadNotifications - 1));
    }
    await deleteNotification(notif.notification_id);
  };

  const handleDismissSingleCommunityActivity = async (
    e: React.MouseEvent,
    act: ActivityFeed
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return;
    const next = new Set(dismissedActivityIdsRef.current);
    next.add(act.activity_id);
    persistDismissedIds(user.uid, next);
    // Only hide from this user's bell panel — never delete the shared community post
    await dismissCommunityActivity(act.activity_id);
  };

  const handleClearAllItems = async () => {
    if (!user) return;

    const activityIdsToDismiss = communityUpdates.map((a) => a.activity_id);
    const latestActivityTs = communityUpdates.reduce((maxTs, a) => {
      const ts = Date.parse(a.timestamp);
      return !Number.isNaN(ts) && ts > maxTs ? ts : maxTs;
    }, 0);
    const dismissBeforeMs = Math.max(Date.now(), latestActivityTs);
    const dismissBeforeIso = new Date(dismissBeforeMs).toISOString();

    if (bellTab === "ALL" || bellTab === "RELEASES") {
      const toDelete = visibleNotifications.filter(
        (n) => bellTab === "ALL" || isReleaseNotification(n)
      );
      const nextDeleted = new Set(deletedNotifIdsRef.current);
      toDelete.forEach((n) => nextDeleted.add(n.notification_id));
      persistDeletedNotifIds(user.uid, nextDeleted);

      const remaining = notifications.filter(
        (n) => !nextDeleted.has(n.notification_id)
      );
      setNotifications(remaining);
      setUnreadNotifications(remaining.filter((n) => !n.read).length);
    }

    if (bellTab === "ALL" || bellTab === "COMMUNITY") {
      const next = new Set(dismissedActivityIdsRef.current);
      activityIdsToDismiss.forEach((id) => next.add(id));
      persistDismissedIds(user.uid, next);
      persistDismissedBefore(user.uid, dismissBeforeMs);
    }

    const ok = await clearBellItems(
      bellTab,
      activityIdsToDismiss,
      dismissBeforeIso
    );
    if (!ok && (bellTab === "ALL" || bellTab === "RELEASES")) {
      await deleteAllNotifications(user.uid, bellTab);
    }
  };

  const handleClickNotification = async (notif: InAppNotification) => {
    if (!notif.read) {
      await markNotificationRead(notif.notification_id);
      setNotifications((prev) =>
        prev.map((n) =>
          n.notification_id === notif.notification_id ? { ...n, read: true } : n
        )
      );
      setUnreadNotifications(Math.max(0, unreadNotifications - 1));
    }
    setShowBellPanel(false);
    if (notif.type === "APP_UPDATE") {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
      window.location.reload();
      return;
    }
    if (notif.activity_id) {
      router.push(`/?activity_id=${encodeURIComponent(notif.activity_id)}`);
      return;
    }
    if (notif.work_id) {
      router.push(`/work/${notif.work_id}`);
    }
  };

  const combinedItems = useMemo(() => {
    const items: Array<
      | { kind: "NOTIF"; timestamp: string; data: InAppNotification }
      | { kind: "ACTIVITY"; timestamp: string; data: ActivityFeed }
    > = [];

    if (bellTab === "ALL" || bellTab === "RELEASES") {
      visibleNotifications.forEach((n) => {
        if (bellTab === "RELEASES" && !isReleaseNotification(n)) {
          return;
        }
        items.push({ kind: "NOTIF", timestamp: n.timestamp, data: n });
      });
    }

    if (bellTab === "ALL" || bellTab === "COMMUNITY") {
      visibleCommunityUpdates.forEach((a) => {
        items.push({ kind: "ACTIVITY", timestamp: a.timestamp, data: a });
      });
    }

    return items
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      )
      .slice(0, 35);
  }, [bellTab, visibleNotifications, visibleCommunityUpdates]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-800 bg-app/85 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2.5 group">
          <img
            src="/anipulse-192x192.png"
            alt="AniPulse"
            className="w-8 h-8 rounded-xl object-cover border border-accent-border shadow-sm group-hover:scale-105 transition-transform"
          />
          <h1 className="text-xl font-extrabold tracking-tight text-white">
            <span className="bg-accent-gradient-text">Ani</span>
            Pulse
          </h1>
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-3.5">
          <PWAInstallPrompt />
          <button
            type="button"
            onClick={toggleContentType}
            className="flex items-center gap-1 rounded-full bg-surface-elevated p-1 shadow-inner border border-gray-800 transition-all duration-300"
            aria-label="Zwischen Anime und Manga wechseln"
          >
            <div
              className={`flex h-7 w-16 sm:w-20 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300 ${
                contentType === "ANIME"
                  ? "bg-accent text-white shadow-md"
                  : "text-gray-400"
              }`}
            >
              Anime
            </div>
            <div
              className={`flex h-7 w-16 sm:w-20 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300 ${
                contentType === "MANGA"
                  ? "bg-accent text-white shadow-md"
                  : "text-gray-400"
              }`}
            >
              Manga
            </div>
          </button>

          <Link
            href="/search"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-elevated text-gray-400 border border-gray-800 hover:text-white transition"
            title="Suche"
          >
            <Search size={16} />
          </Link>

          {/* BELL ICON FOR RELEASES, REVIEWS & COMMUNITY UPDATES */}
          {user && (
            <div className="relative" ref={panelRef}>
              <button
                type="button"
                onClick={handleToggleBellPanel}
                className={`relative flex h-8 w-8 items-center justify-center rounded-full border transition ${
                  showBellPanel
                    ? "bg-accent-soft border-accent-border-strong text-accent-light"
                    : "bg-surface-elevated border-gray-800 text-gray-300 hover:text-white"
                }`}
                title="Neuigkeiten & Community-Updates"
              >
                <Bell size={16} />
                {totalBadgeCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-extrabold text-white shadow">
                    {totalBadgeCount > 9 ? "9+" : totalBadgeCount}
                  </span>
                )}
              </button>

              {showBellPanel && (
                <div className="fixed sm:absolute right-3 sm:right-0 top-16 sm:top-full sm:mt-2 w-[calc(100vw-1.5rem)] sm:w-96 max-h-[75vh] bg-surface border border-gray-700/80 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-800 bg-surface-inset">
                    <div className="flex items-center gap-2">
                      <Bell size={14} className="text-accent-text" />
                      <span className="text-xs font-bold text-white">
                        Updates &amp; Aktivitäten
                      </span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      {unreadNotifCount > 0 && (
                        <button
                          type="button"
                          onClick={handleMarkAllRead}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-text hover:text-accent-light"
                          title="Alle als gelesen markieren"
                        >
                          <CheckCheck size={13} />
                          Gelesen
                        </button>
                      )}
                      {combinedItems.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearAllItems}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300"
                          title="Alle Nachrichten in dieser Ansicht ausblenden"
                        >
                          <Trash2 size={13} />
                          Leeren
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowBellPanel(false)}
                        className="text-gray-400 hover:text-white p-0.5"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex border-b border-gray-800 bg-surface-inset/70 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setBellTab("ALL")}
                      className={`flex-1 py-2 text-center border-b-2 transition ${
                        bellTab === "ALL"
                          ? "border-accent text-white bg-accent-soft"
                          : "border-transparent text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      Alle
                    </button>
                    <button
                      type="button"
                      onClick={() => setBellTab("RELEASES")}
                      className={`flex-1 py-2 text-center border-b-2 transition ${
                        bellTab === "RELEASES"
                          ? "border-accent text-accent-light bg-accent-soft"
                          : "border-transparent text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      Releases &amp; Alerts
                    </button>
                    <button
                      type="button"
                      onClick={() => setBellTab("COMMUNITY")}
                      className={`flex-1 py-2 text-center border-b-2 transition ${
                        bellTab === "COMMUNITY"
                          ? "border-purple-500 text-purple-300 bg-purple-500/10"
                          : "border-transparent text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      Bibliothek &amp; Freunde
                    </button>
                  </div>

                  {/* List */}
                  <div className="overflow-y-auto divide-y divide-gray-800/70 max-h-[58vh]">
                    {combinedItems.length === 0 ? (
                      <div className="p-6 text-center text-xs text-gray-400">
                        Keine Nachrichten vorhanden.
                      </div>
                    ) : (
                      combinedItems.map((entry) => {
                        if (entry.kind === "NOTIF") {
                          const n = entry.data;
                          const media = n.work_id
                            ? workDetailsMap[n.work_id]
                            : undefined;
                          const workTitle =
                            n.work_title || (media ? getAniListTitle(media) : "");
                          const badge = getNotificationBadge(n.type);

                          return (
                            <div
                              key={`notif_${n.notification_id}`}
                              onClick={() => handleClickNotification(n)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleClickNotification(n);
                              }}
                              className={`w-full flex items-start gap-2.5 p-3 text-left hover:bg-white/[0.04] transition cursor-pointer group ${
                                !n.read ? "bg-accent-soft" : ""
                              }`}
                            >
                              {n.actor_id && n.actor_id !== "SYSTEM" ? (
                                <Link
                                  href={
                                    n.actor_id === user?.uid
                                      ? "/profile"
                                      : `/profile/${n.actor_id}`
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowBellPanel(false);
                                  }}
                                  className="w-8 h-8 rounded-full bg-gray-800 border border-white/10 hover:border-accent-border-strong shrink-0 overflow-hidden flex items-center justify-center mt-0.5 transition-colors"
                                  title={`Profil von ${n.actor_name} ansehen`}
                                >
                                  {n.actor_avatar ? (
                                    <img
                                      src={n.actor_avatar}
                                      alt={n.actor_name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <span className="text-xs font-bold text-accent-light">
                                      {(n.actor_name || "U")
                                        .slice(0, 1)
                                        .toUpperCase()}
                                    </span>
                                  )}
                                </Link>
                              ) : (
                                <div className="w-8 h-8 rounded-full bg-gray-800 border border-white/10 shrink-0 overflow-hidden flex items-center justify-center mt-0.5">
                                  {media?.coverImage?.large ? (
                                    <img
                                      src={media.coverImage.large}
                                      alt=""
                                      className="w-full h-full object-cover"
                                    />
                                  ) : n.actor_avatar ? (
                                    <img
                                      src={n.actor_avatar}
                                      alt=""
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <Sparkles
                                      size={14}
                                      className="text-accent-text"
                                    />
                                  )}
                                </div>
                              )}

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span
                                    className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${badge.className}`}
                                  >
                                    {badge.label}
                                  </span>
                                  {n.actor_id && n.actor_id !== "SYSTEM" && (
                                    <Link
                                      href={
                                        n.actor_id === user?.uid
                                          ? "/profile"
                                          : `/profile/${n.actor_id}`
                                      }
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setShowBellPanel(false);
                                      }}
                                      className="text-xs font-bold text-accent-light hover:underline truncate"
                                    >
                                      {n.actor_name}
                                    </Link>
                                  )}
                                  {workTitle && (
                                    <span className="text-xs font-bold text-white truncate">
                                      {workTitle}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-300 mt-1 leading-snug">
                                  {n.text}
                                </p>
                                <span className="block text-[10px] text-gray-500 mt-1">
                                  {formatDistanceToNow(new Date(n.timestamp), {
                                    addSuffix: true,
                                    locale: de,
                                  })}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                                {!n.read && (
                                  <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                                )}
                                <button
                                  type="button"
                                  onClick={(e) =>
                                    handleDeleteSingleNotification(e, n)
                                  }
                                  className="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                                  title="Nachricht löschen"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        }

                        const a = entry.data;
                        const actor = actorProfiles[a.user_id];
                        const actorName =
                          actor?.username ||
                          (a.user_id === user?.uid ? "Du" : "Community-Mitglied");
                        const media = a.work_id
                          ? workDetailsMap[a.work_id]
                          : undefined;
                        const workTitle = media ? getAniListTitle(media) : "";
                        const profileHref =
                          a.user_id === user?.uid
                            ? "/profile"
                            : `/profile/${a.user_id}`;

                        let badgeText = "Update";
                        let badgeColor =
                          "bg-purple-500/20 text-purple-300 border-purple-500/30";
                        if (a.action_type === "TOP9_UPDATE") {
                          badgeText = "Bibliothek";
                          badgeColor =
                            "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
                        }

                        const targetHref = a.work_id ? `/work/${a.work_id}` : "/";

                        return (
                          <div
                            key={`act_${a.activity_id}`}
                            className="flex items-start gap-2.5 p-3 hover:bg-white/[0.04] transition group"
                          >
                            <Link
                              href={profileHref}
                              onClick={() => setShowBellPanel(false)}
                              className="w-8 h-8 rounded-full bg-gray-800 border border-white/10 hover:border-accent-border-strong shrink-0 overflow-hidden flex items-center justify-center mt-0.5 transition-colors"
                              title={`Profil von ${actorName} ansehen`}
                            >
                              {actor?.avatar_url ? (
                                <img
                                  src={actor.avatar_url}
                                  alt={actorName}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-xs font-bold text-accent-light">
                                  {actorName.slice(0, 1).toUpperCase()}
                                </span>
                              )}
                            </Link>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${badgeColor}`}
                                >
                                  {badgeText}
                                </span>
                                <Link
                                  href={profileHref}
                                  onClick={() => setShowBellPanel(false)}
                                  className="text-xs font-bold text-white hover:text-accent-light hover:underline truncate transition-colors"
                                  title={`Profil von ${actorName} ansehen`}
                                >
                                  {actorName}
                                </Link>
                                {workTitle && (
                                  <Link
                                    href={targetHref}
                                    onClick={() => setShowBellPanel(false)}
                                    className="text-[11px] text-accent-light hover:underline font-semibold truncate"
                                  >
                                    • {workTitle}
                                  </Link>
                                )}
                              </div>
                              <Link
                                href={targetHref}
                                onClick={() => setShowBellPanel(false)}
                                className="block"
                              >
                                <p className="text-xs text-gray-300 mt-1 leading-snug line-clamp-2 hover:text-white transition-colors">
                                  {a.text || a.details || "Neues Update"}
                                </p>
                                <span className="block text-[10px] text-gray-500 mt-1">
                                  {formatDistanceToNow(new Date(a.timestamp), {
                                    addSuffix: true,
                                    locale: de,
                                  })}
                                </span>
                              </Link>
                            </div>

                            <button
                              type="button"
                              onClick={(e) =>
                                handleDismissSingleCommunityActivity(e, a)
                              }
                              className="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition shrink-0 mt-0.5"
                              title="Aus der Glocke entfernen"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {user ? (
            <Link
              href="/profile"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white font-bold shadow-md hover:bg-accent-hover transition overflow-hidden"
            >
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                user.email?.[0].toUpperCase() || "U"
              )}
            </Link>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-1 text-sm font-semibold text-accent-text hover:text-accent-light transition"
            >
              <LogIn size={18} />
              <span className="hidden sm:inline">Login</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

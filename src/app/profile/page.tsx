"use client";

import {
  User as UserIcon,
  X,
  LogOut,
  LogIn,
  Bell,
  Star,
  ChevronDown,
  ChevronUp,
  Palette,
  Check,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import {
  getUserProfile,
  updateNotificationSettings,
  updateUserProfileData,
} from "@/lib/db/users";
import { requestForToken, repairToken } from "@/lib/fcm";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import { AccentTheme, useAppStore } from "@/lib/store";
import { ProfileStats } from "@/components/ui/ProfileStats";
import { UserProfile, UserWork } from "@/types/database";
import { AniListMedia, getAniListTitle } from "@/types/anilist";
import { toast } from "@/lib/ui-feedback";

interface FavoriteWorkDetails extends AniListMedia {
  userScore?: number;
}

function FavoriteItem({
  id,
  index,
  workDetails,
}: {
  id: string;
  index: number;
  workDetails?: FavoriteWorkDetails;
}) {
  const cover =
    workDetails?.coverImage?.extraLarge || workDetails?.coverImage?.large;

  return (
    <div className="w-full aspect-[3/4] relative rounded-lg bg-surface-elevated border border-gray-700 hover:border-accent-border-strong transition flex items-center justify-center font-bold text-gray-500 overflow-hidden shadow-sm group">
      <span className="absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent font-bold text-white shadow-md z-10 border border-accent-border-strong text-[10px]">
        {index + 1}
      </span>

      {workDetails ? (
        <Link
          href={`/work/${id}`}
          className="absolute inset-0 block h-full w-full group"
        >
          {cover ? (
            <img
              src={cover}
              alt={getAniListTitle(workDetails, "Cover")}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="h-full w-full bg-gray-800" />
          )}
          <div className="absolute bottom-0 w-full bg-black/80 backdrop-blur-md text-[10px] text-center text-accent-light py-1 font-bold">
            ★ {workDetails.userScore?.toFixed(1) || "?"}
          </div>
        </Link>
      ) : (
        <span className="text-xs text-center p-2 text-white line-clamp-3">
          Lade...
        </span>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const contentType = useAppStore((s) => s.contentType);
  const accentTheme = useAppStore((s) => s.accentTheme);
  const setAccentTheme = useAppStore((s) => s.setAccentTheme);

  const [user, setUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<UserProfile | null>(null);
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [showPushSection, setShowPushSection] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");

  const [notifySettings, setNotifySettings] = useState({
    releases: true,
    likes: true,
    replies: true,
    social: true,
  });

  const [allWorks, setAllWorks] = useState<UserWork[]>([]);
  const [aniListDetails, setAniListDetails] = useState<
    Record<string, AniListMedia>
  >({});
  const [onlyMalOpen, setOnlyMalOpen] = useState(false);

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const profile = await getUserProfile(currentUser.uid);
        if (profile) {
          setDbUser(profile);
          if (profile.notification_settings) {
            setNotifySettings(profile.notification_settings);
          }
          setIsPushEnabled(
            Boolean(profile.fcm_tokens && profile.fcm_tokens.length > 0)
          );
        }

        const works = await getAllUserWorks(currentUser.uid);
        setAllWorks(works);
        const idsToFetch = works
          .map((w) => parseInt(w.work_id, 10))
          .filter((n) => !Number.isNaN(n) && n > 0);
        if (idsToFetch.length > 0) {
          const mediaList = await fetchAniListBatch(idsToFetch);
          const map: Record<string, AniListMedia> = {};
          mediaList.forEach((m) => {
            map[m.id.toString()] = m;
          });
          setAniListDetails(map);
        } else {
          setAniListDetails({});
        }
      } else {
        setDbUser(null);
        setAllWorks([]);
        setAniListDetails({});
        setIsPushEnabled(false);
        setShowPushSection(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
      router.push("/login");
    }
  };

  const handleToggle = async (key: keyof typeof notifySettings) => {
    if (!user) return;
    const newSettings = { ...notifySettings, [key]: !notifySettings[key] };
    setNotifySettings(newSettings);
    await updateNotificationSettings(user.uid, newSettings);
  };

  const handleThemeChange = (theme: AccentTheme) => {
    setAccentTheme(theme);
    toast.success(
      theme === "emerald"
        ? "Farbschema auf Emerald Grün umgestellt."
        : "Farbschema auf AniPulse Blau umgestellt."
    );
  };

  const handleRepairPush = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const token = await repairToken(user.uid);
      if (token) {
        setIsPushEnabled(true);
        toast.success("Push-Benachrichtigungen erfolgreich repariert!");
      } else if (
        typeof Notification !== "undefined" &&
        Notification.permission === "denied"
      ) {
        toast.error(
          "Benachrichtigungen sind im Browser blockiert. Bitte erlaube sie in den Website-Einstellungen."
        );
      } else {
        toast.error(
          "Fehler beim Reparieren der Push-Benachrichtigungen. Bitte prüfe die Browser-Berechtigungen."
        );
      }
    } catch (e) {
      console.error(e);
      toast.error("Fehler beim Reparieren der Push-Benachrichtigungen.");
    } finally {
      setIsSaving(false);
    }
  };

  const enablePush = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const token = await requestForToken(user.uid);
      if (token) {
        setIsPushEnabled(true);
        toast.success("Push-Benachrichtigungen aktiviert!");
      } else if (
        typeof Notification !== "undefined" &&
        Notification.permission === "denied"
      ) {
        toast.error(
          "Benachrichtigungen sind im Browser blockiert. Bitte erlaube sie in den Website-Einstellungen."
        );
      } else {
        toast.error("Push-Benachrichtigungen konnten nicht aktiviert werden.");
      }
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error
          ? `Fehler beim Aktivieren: ${e.message}`
          : "Fehler beim Aktivieren der Push-Benachrichtigungen."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const MAX_SIZE = 256;
        let width = img.width;
        let height = img.height;

        if (width > height && width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        } else if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }

        canvas.width = width;
        canvas.height = height;

        ctx?.drawImage(img, 0, 0, width, height);
        const base64String = canvas.toDataURL("image/jpeg", 0.8);
        setEditAvatarUrl(base64String);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSaving(true);
    try {
      await updateUserProfileData(user.uid, editUsername, editAvatarUrl);
      setDbUser((prev) =>
        prev
          ? { ...prev, username: editUsername, avatar_url: editAvatarUrl }
          : null
      );
      setIsEditingProfile(false);
      toast.success("Profil gespeichert.");
    } catch (e) {
      console.error(e);
      toast.error("Fehler beim Speichern des Profils.");
    } finally {
      setIsSaving(false);
    }
  };

  const favItems = useMemo(() => {
    if (!dbUser || Object.keys(aniListDetails).length === 0) return [];

    return allWorks
      .filter((w) => {
        const score =
          Number(w.evaluation?.overallScore) ||
          Number(w.evaluation?.manualScore) ||
          0;
        return (
          aniListDetails[w.work_id]?.type === contentType &&
          w.status !== "PLANNING" &&
          score > 0
        );
      })
      .sort((a, b) => {
        const scoreA =
          Number(a.evaluation?.overallScore) ||
          Number(a.evaluation?.manualScore) ||
          0;
        const scoreB =
          Number(b.evaluation?.overallScore) ||
          Number(b.evaluation?.manualScore) ||
          0;
        return scoreB - scoreA;
      })
      .slice(0, 9)
      .map((w) => {
        const score =
          Number(w.evaluation?.overallScore) ||
          Number(w.evaluation?.manualScore) ||
          0;
        return {
          id: w.work_id,
          details: {
            ...aniListDetails[w.work_id],
            userScore: score,
          } as FavoriteWorkDetails,
        };
      });
  }, [contentType, dbUser, aniListDetails, allWorks]);

  const ratedWorks = useMemo(() => {
    return allWorks
      .filter((w) => {
        const score =
          Number(w.evaluation?.overallScore) ||
          Number(w.evaluation?.manualScore) ||
          0;
        return (
          aniListDetails[w.work_id]?.type === contentType &&
          score > 0 &&
          (!onlyMalOpen || !w.mal_rated)
        );
      })
      .sort((a, b) => {
        const scoreA =
          Number(a.evaluation?.overallScore) ||
          Number(a.evaluation?.manualScore) ||
          0;
        const scoreB =
          Number(b.evaluation?.overallScore) ||
          Number(b.evaluation?.manualScore) ||
          0;
        return scoreB - scoreA;
      });
  }, [allWorks, aniListDetails, contentType, onlyMalOpen]);

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <UserIcon className="text-accent-text" />
          Profil
        </h2>
      </div>

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-800 bg-surface-elevated p-6 shadow-lg relative">
        {user && (
          <button
            type="button"
            onClick={() => {
              setEditUsername(dbUser?.username || "");
              setEditAvatarUrl(dbUser?.avatar_url || "");
              setIsEditingProfile(true);
            }}
            className="absolute top-4 right-4 text-xs bg-gray-800 hover:bg-gray-700 px-3 py-1 rounded transition text-gray-300 font-bold"
          >
            Profil bearbeiten
          </button>
        )}

        <div className="h-24 w-24 rounded-full bg-gray-800 flex items-center justify-center text-3xl font-bold text-white shadow-accent-glow border border-accent-border overflow-hidden">
          {dbUser?.avatar_url ? (
            <img
              src={dbUser.avatar_url}
              alt="Avatar"
              className="w-full h-full object-cover"
            />
          ) : (
            dbUser?.username?.[0]?.toUpperCase() ||
            auth?.currentUser?.email?.[0]?.toUpperCase() ||
            "U"
          )}
        </div>
        <div className="text-center">
          <h3 className="text-lg font-bold">
            {dbUser?.username || user?.displayName || "AniPulse User"}
          </h3>
          <p className="text-sm text-gray-400">
            {user?.email || "Nicht angemeldet"}
          </p>
        </div>

        {user ? (
          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-900/20 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-900/40"
          >
            <LogOut size={16} /> Abmelden
          </button>
        ) : (
          <Link
            href="/login"
            className="mt-4 flex items-center gap-2 rounded-lg bg-accent px-6 py-2 text-sm font-bold text-white transition hover:bg-accent-hover shadow-lg"
          >
            <LogIn size={16} /> Jetzt Einloggen
          </Link>
        )}
      </div>

      {/* DESIGN & FARBSCHEMA SWITCHER (App-wide Emerald <-> Blue) */}
      <section className="bg-surface-elevated border border-gray-800 rounded-2xl p-4 shadow-lg flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Palette size={17} className="text-accent-text shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-white">
                Design &amp; Farbschema
              </h3>
              <p className="text-[11px] text-gray-400">
                Gilt sofort für die gesamte App (Navigation, Feed, Kalender &amp;
                Buttons)
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => handleThemeChange("emerald")}
            className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition ${
              accentTheme === "emerald"
                ? "bg-emerald-500/15 border-emerald-500/60 text-white shadow-sm"
                : "bg-surface-inset border-gray-800 text-gray-300 hover:border-gray-700"
            }`}
          >
            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 border border-emerald-300/40 shrink-0 flex items-center justify-center">
              {accentTheme === "emerald" && (
                <Check size={13} className="text-white" />
              )}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold leading-tight">
                Emerald Grün
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">Standard</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleThemeChange("blue")}
            className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition ${
              accentTheme === "blue"
                ? "bg-blue-500/15 border-blue-500/60 text-white shadow-sm"
                : "bg-surface-inset border-gray-800 text-gray-300 hover:border-gray-700"
            }`}
          >
            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 border border-blue-300/40 shrink-0 flex items-center justify-center">
              {accentTheme === "blue" && (
                <Check size={13} className="text-white" />
              )}
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold leading-tight">
                AniPulse Blau
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">Klassisch</div>
            </div>
          </button>
        </div>
      </section>

      <ProfileStats allWorks={allWorks} aniListDetails={aniListDetails} />

      {user && (
        <section className="bg-surface-elevated border border-gray-800 rounded-2xl shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setShowPushSection((prev) => !prev)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition text-left"
          >
            <div className="flex items-center gap-2.5">
              <Bell size={18} className="text-accent-text shrink-0" />
              <span className="text-base font-bold text-white">
                Push-Benachrichtigungen
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  isPushEnabled
                    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                    : "bg-gray-800 border-gray-700 text-gray-400"
                }`}
              >
                {isPushEnabled ? "Aktiv" : "Inaktiv"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 font-semibold">
              <span>{showPushSection ? "Einklappen" : "Einstellungen"}</span>
              {showPushSection ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </div>
          </button>

          {showPushSection && (
            <div className="px-5 pb-5 pt-2 border-t border-gray-800/80">
              {isPushEnabled && (
                <div className="flex items-center justify-end gap-2 flex-wrap mb-3">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!user) return;
                      setIsSaving(true);
                      try {
                        await requestForToken(user.uid).catch(() => {});

                        const loadedMedia = Object.values(aniListDetails);
                        const sampleAnime = loadedMedia.find(
                          (m) =>
                            m?.type === "ANIME" &&
                            (m?.coverImage?.large || m?.coverImage?.medium)
                        );
                        const sampleManga = loadedMedia.find(
                          (m) =>
                            m?.type === "MANGA" &&
                            (m?.coverImage?.large || m?.coverImage?.medium)
                        );
                        const fallbackSample = loadedMedia.find(
                          (m) => m?.coverImage?.large || m?.coverImage?.medium
                        );
                        const sampleAnimeIcon =
                          sampleAnime?.coverImage?.large ||
                          sampleAnime?.coverImage?.medium ||
                          fallbackSample?.coverImage?.large ||
                          fallbackSample?.coverImage?.medium ||
                          undefined;
                        const sampleMangaIcon =
                          sampleManga?.coverImage?.large ||
                          sampleManga?.coverImage?.medium ||
                          sampleAnimeIcon;
                        const demoActor =
                          dbUser?.username || "AniPulse-User";

                        const testScenarios: Array<{
                          type: string;
                          tag: string;
                          title: string;
                          body: string;
                          link: string;
                          icon?: string;
                        }> = [
                          {
                            type: "releases",
                            tag: `test-1-anime-release-${Date.now()}`,
                            title:
                              "[Test 1/7 · Anime-Release] Neue Folge verfügbar!",
                            body: "Episode 12 von Solo Leveling Season 2 ist jetzt online.",
                            link: "/calendar",
                            icon: sampleAnimeIcon,
                          },
                          {
                            type: "releases",
                            tag: `test-2-manga-release-${Date.now()}`,
                            title:
                              "[Test 2/7 · Manga-Release] Neues Kapitel verfügbar!",
                            body: "Kapitel 1140 von One Piece ist jetzt online.",
                            link: "/calendar",
                            icon: sampleMangaIcon,
                          },
                          {
                            type: "releases",
                            tag: `test-3-wishlist-release-${Date.now()}`,
                            title:
                              "[Test 3/7 · Wunschliste → Aktiv] Jetzt verfügbar!",
                            body: "Chainsaw Man Movie: Reze Arc ist erschienen und wurde in deine Aktiv-Liste verschoben!",
                            link: "/library",
                            icon: sampleAnimeIcon,
                          },
                          {
                            type: "social",
                            tag: `test-4-review-list-${Date.now()}`,
                            title: `[Test 4/7 · Review Feed] Neues Review von ${demoActor}!`,
                            body: `${demoActor} hat 3 Folgen/Kapitel bewertet (Frieren Ep. 28: 10/10 · Dandadan Ep. 12: 9.5/10).`,
                            link: "/",
                            icon: sampleAnimeIcon,
                          },
                          {
                            type: "social",
                            tag: `test-5-rating-${Date.now()}`,
                            title:
                              "[Test 5/7 · Werk-Bewertung] Neue Gesamtbewertung",
                            body: `${demoActor} hat Attack on Titan insgesamt mit 9.8/10 bewertet.`,
                            link: "/",
                            icon: sampleAnimeIcon,
                          },
                          {
                            type: "replies",
                            tag: `test-6-review-reply-${Date.now()}`,
                            title: `[Test 6/7 · Meinung] ${demoActor} zu deinem Review`,
                            body: "„Stimme dir komplett zu, das Pacing und die Animation am Ende waren eine glatte 10/10!“",
                            link: "/",
                            icon: sampleAnimeIcon,
                          },
                          {
                            type: "likes",
                            tag: `test-7-reaction-${Date.now()}`,
                            title: `[Test 7/7 · Reaktion] ${demoActor} hat reagiert 🔥`,
                            body: "Neue Reaktion auf deinen Review-Beitrag im Feed.",
                            link: "/",
                            icon: sampleMangaIcon,
                          },
                        ];

                        await new Promise((r) => setTimeout(r, 3000));

                        let totalSent = 0;
                        for (let i = 0; i < testScenarios.length; i++) {
                          const item = testScenarios[i];
                          const res = await fetch("/api/notify", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              targetUserId: user.uid,
                              type: item.type,
                              title: item.title,
                              body: item.body,
                              link: item.link,
                              tag: item.tag,
                              icon: item.icon,
                              forceNotification: true,
                            }),
                          });
                          const data = await res.json();
                          if (data.success && data.successCount > 0) {
                            totalSent++;
                          }
                          if (i < testScenarios.length - 1) {
                            await new Promise((r) => setTimeout(r, 350));
                          }
                        }

                        if (totalSent > 0) {
                          toast.success(
                            `${totalSent}/${testScenarios.length} Test-Push-Benachrichtigungen gesendet!`
                          );
                        } else {
                          toast.error(
                            "Push-Token abgelaufen. Klicke einmal auf „Reparieren“."
                          );
                        }
                      } catch (err) {
                        console.error(err);
                        toast.error(
                          "Fehler beim Senden der Test-Benachrichtigungen."
                        );
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    disabled={isSaving}
                    className="text-[11px] bg-accent-soft hover:bg-accent-soft-hover text-accent-light border border-accent-border px-2.5 py-1 rounded-lg font-semibold transition"
                  >
                    {isSaving
                      ? "Sende 7 Tests (3s)..."
                      : "Alle 7 Push-Arten testen"}
                  </button>
                  <button
                    type="button"
                    onClick={handleRepairPush}
                    disabled={isSaving}
                    className="text-[11px] bg-amber-600/20 hover:bg-amber-600/35 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-lg font-semibold transition"
                  >
                    {isSaving ? "..." : "Reparieren"}
                  </button>
                </div>
              )}

              {isPushEnabled && (
                <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
                  <strong>Tipp für den Sperrbildschirm-Test:</strong> Nach Klick
                  auf{" "}
                  <span className="text-accent-light font-semibold">
                    „Alle 7 Push-Arten testen“
                  </span>{" "}
                  startet ein <strong>3-Sekunden-Countdown</strong> – sperre in
                  diesen 3 Sekunden direkt dein Handy, damit du alle
                  Benachrichtigungen live auf dem Lock-Screen siehst.
                </p>
              )}

              {typeof window !== "undefined" &&
                typeof Notification !== "undefined" &&
                Notification.permission !== "granted" &&
                isPushEnabled && (
                  <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-center justify-between gap-2">
                    <span>
                      Auf diesem Gerät/Browser sind Push-Mitteilungen noch nicht
                      erlaubt.
                    </span>
                    <button
                      type="button"
                      onClick={enablePush}
                      disabled={isSaving}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-black font-bold shrink-0"
                    >
                      Hier aktivieren
                    </button>
                  </div>
                )}

              {!isPushEnabled ? (
                <div className="text-center">
                  <p className="text-xs text-gray-400 mb-4">
                    Erlaube Push-Benachrichtigungen, um über neue Folgen,
                    Kapitel und Reviews informiert zu werden.
                  </p>
                  <button
                    type="button"
                    onClick={enablePush}
                    disabled={isSaving}
                    className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-3 px-4 rounded-lg transition disabled:opacity-50"
                  >
                    {isSaving
                      ? "Aktiviert..."
                      : "Push-Benachrichtigungen aktivieren"}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">
                        Neue Folgen &amp; Kapitel
                      </div>
                      <div className="text-xs text-gray-500">
                        Für Werke aus deiner Bibliothek
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggle("releases")}
                      className={`w-12 h-6 rounded-full transition-colors relative ${
                        notifySettings.releases ? "bg-accent" : "bg-gray-700"
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${
                          notifySettings.releases
                            ? "translate-x-6"
                            : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">
                        Likes &amp; Reaktionen
                      </div>
                      <div className="text-xs text-gray-500">
                        Wenn jemand auf deine Beiträge reagiert
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggle("likes")}
                      className={`w-12 h-6 rounded-full transition-colors relative ${
                        notifySettings.likes ? "bg-accent" : "bg-gray-700"
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${
                          notifySettings.likes
                            ? "translate-x-6"
                            : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">
                        Antworten &amp; Meinungen
                      </div>
                      <div className="text-xs text-gray-500">
                        Auf deine Reviews und Kommentare
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggle("replies")}
                      className={`w-12 h-6 rounded-full transition-colors relative ${
                        notifySettings.replies ? "bg-accent" : "bg-gray-700"
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${
                          notifySettings.replies
                            ? "translate-x-6"
                            : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">
                        Review Feed
                      </div>
                      <div className="text-xs text-gray-500">
                        Neue Reviews &amp; Beiträge der Community
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggle("social")}
                      className={`w-12 h-6 rounded-full transition-colors relative ${
                        notifySettings.social ? "bg-accent" : "bg-gray-700"
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${
                          notifySettings.social
                            ? "translate-x-6"
                            : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {user && (
        <section>
          <h3 className="mb-1.5 text-lg font-bold flex items-center gap-2">
            <Star className="text-accent-text" />
            Meine All-Time Top 9 ({contentType})
          </h3>
          <p className="text-xs text-gray-400 mb-4">
            Deine 9 bestbewerteten Werke. Wird automatisch berechnet.
          </p>

          {favItems.length === 0 ? (
            <div className="text-sm text-gray-500 border border-gray-800 bg-surface-elevated rounded-xl p-6 text-center">
              Du hast noch keine Werke bewertet.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 mt-2">
              {favItems.map((item, index) => (
                <FavoriteItem
                  key={item.id}
                  id={item.id}
                  index={index}
                  workDetails={item.details}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {user && (
        <section className="bg-surface-elevated border border-gray-800 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-base font-bold text-white">
              Alle Bewertungen ({ratedWorks.length})
            </h3>
            <button
              type="button"
              onClick={() => setOnlyMalOpen((prev) => !prev)}
              className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors whitespace-nowrap ${
                onlyMalOpen
                  ? "bg-amber-500/20 border-amber-500/50 text-amber-300"
                  : "bg-surface-inset border-gray-700 text-gray-400 hover:text-white"
              }`}
            >
              Nur AniList/MAL offen
            </button>
          </div>

          {ratedWorks.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">
              {onlyMalOpen
                ? "Alle bewerteten Werke sind bereits auf AniList/MAL markiert."
                : "Keine bewerteten Werke für diese Kategorie vorhanden."}
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
              {ratedWorks.map((w) => {
                const details = aniListDetails[w.work_id];
                const title = getAniListTitle(details, `Werk #${w.work_id}`);
                const cover =
                  details?.coverImage?.large || details?.coverImage?.extraLarge;
                const score =
                  Number(w.evaluation?.overallScore) ||
                  Number(w.evaluation?.manualScore) ||
                  0;
                const rewatch = w.evaluation?.rewatchPotential || 0;

                return (
                  <div
                    key={w.work_id}
                    className="flex items-center gap-3 rounded-xl border border-gray-800/90 bg-surface-inset p-2.5 hover:border-gray-700 transition-colors"
                  >
                    <Link
                      href={`/work/${w.work_id}`}
                      className="w-10 h-14 rounded-md overflow-hidden bg-gray-800 shrink-0 block"
                    >
                      {cover ? (
                        <img
                          src={cover}
                          alt={title}
                          className="w-full h-full object-cover"
                        />
                      ) : null}
                    </Link>

                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/work/${w.work_id}`}
                        className="text-sm font-semibold text-white hover:text-accent-light transition-colors line-clamp-1 block"
                      >
                        {title}
                      </Link>
                      <div className="flex items-center flex-wrap gap-1.5 mt-1">
                        {rewatch > 0 && (
                          <span className="inline-flex items-center rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                            Rewatch: {rewatch}/10
                          </span>
                        )}
                        {!w.mal_rated && (
                          <span className="inline-flex items-center rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                            AniList offen
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="text-sm font-bold text-accent-text shrink-0 tabular-nums">
                      ★ {score.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Profil Edit Modal */}
      {isEditingProfile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onClick={() => !isSaving && setIsEditingProfile(false)}
        >
          <form
            onSubmit={handleSaveProfile}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-gray-800 bg-surface shadow-2xl overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800/80">
              <h3 className="text-sm font-bold text-white">
                Profil bearbeiten
              </h3>
              <button
                type="button"
                onClick={() => !isSaving && setIsEditingProfile(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                aria-label="Schließen"
              >
                <X size={17} />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5">
                <label className="block text-xs font-bold text-gray-300 mb-1.5">
                  Benutzername
                </label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full bg-surface-control border border-gray-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-border-strong"
                  required
                />
              </div>

              <div className="rounded-xl border border-gray-800/90 bg-surface-inset p-3.5">
                <label className="block text-xs font-bold text-gray-300 mb-2.5">
                  Profilbild
                </label>

                <div className="flex flex-col items-center gap-3">
                  <div className="h-20 w-20 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden border border-gray-700">
                    {editAvatarUrl ? (
                      <img
                        src={editAvatarUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-gray-500 text-xs">Kein Bild</span>
                    )}
                  </div>

                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                  />

                  <div className="flex gap-2 w-full">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 bg-surface-control hover:bg-gray-700 text-white text-xs font-semibold py-2 rounded-xl transition"
                    >
                      Bild vom Handy wählen
                    </button>
                    {editAvatarUrl && (
                      <button
                        type="button"
                        onClick={() => setEditAvatarUrl("")}
                        className="bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold px-3 py-2 rounded-xl transition"
                      >
                        Entfernen
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 w-full text-center">
                    Bild wird automatisch optimiert gespeichert.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-800/80 bg-surface-inset">
              <button
                type="button"
                onClick={() => setIsEditingProfile(false)}
                disabled={isSaving}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-accent hover:bg-accent-hover disabled:opacity-50 transition shadow-md"
              >
                {isSaving ? "Speichert..." : "Speichern"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

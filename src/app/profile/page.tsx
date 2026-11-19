"use client";

import { User as UserIcon, Settings, LogOut, LogIn, Bell, Star } from "lucide-react";
import { auth } from "@/lib/firebase";
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { getUserProfile, updateNotificationSettings, updateTop9List, updateUserProfileData } from "@/lib/db/users";
import { requestForToken, repairToken } from "@/lib/fcm";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import { useAppStore } from "@/lib/store";
import { ProfileStats } from "@/components/ui/ProfileStats";

function FavoriteItem({ id, index, workDetails }: { id: string, index: number, workDetails?: any }) {
  return (
    <div className={`w-full aspect-[3/4] relative rounded-lg bg-[#1a1d24] border border-gray-700 hover:border-blue-500 transition flex items-center justify-center font-bold text-gray-500 overflow-hidden shadow-sm group`}>
      <span className="absolute top-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 font-bold text-white shadow-md z-10 border border-blue-400 text-[10px]">
        {index + 1}
      </span>
      
      {workDetails ? (
        <Link href={`/work/${id}`} className="absolute inset-0 block h-full w-full group">
          <img src={workDetails.coverImage?.extraLarge || workDetails.coverImage?.large} alt="Cover" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          <div className="absolute bottom-0 w-full bg-black/80 backdrop-blur-md text-[10px] text-center text-blue-400 py-1 font-bold">
            â˜… {workDetails.userScore?.toFixed(1) || "?"}
          </div>
        </Link>
      ) : (
        <span className="text-xs text-center p-2 text-white line-clamp-3">Lade...</span>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { contentType } = useAppStore();

  const [user, setUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<any>(null);
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");

  const [notifySettings, setNotifySettings] = useState({
    releases: true,
    likes: true,
    replies: true,
    social: true
  });
  
  const [allWorks, setAllWorks] = useState<any[]>([]);
  const [aniListDetails, setAniListDetails] = useState<Record<string, any>>({});
  const [favItems, setFavItems] = useState<any[]>([]);
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
          if (profile.fcm_tokens && profile.fcm_tokens.length > 0) {
            setIsPushEnabled(true);
          }
        }
        
        const works = await getAllUserWorks(currentUser.uid);
        setAllWorks(works);
        const idsToFetch = works.map(w => parseInt(w.work_id, 10));
        if (idsToFetch.length > 0) {
          const mediaList = await fetchAniListBatch(idsToFetch);
          const map: Record<string, any> = {};
          mediaList.forEach((m: any) => { map[m.id.toString()] = m; });
          setAniListDetails(map);
        }
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

    const handleRepairPush = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const token = await repairToken(user.uid);
      if (token) {
        setIsPushEnabled(true);
        alert("Push-Benachrichtigungen erfolgreich repariert!");
      } else {
        if (typeof Notification !== "undefined" && Notification.permission === "denied") { alert("Benachrichtigungen sind im Browser blockiert. Bitte erlaube Push-Benachrichtigungen in den Browser-/Website-Einstellungen."); } else { alert("Fehler beim Reparieren der Push-Benachrichtigungen. Bitte prüfe die Browser-Berechtigungen, den Service Worker und die Firestore-Regeln."); }
      }
    } catch (e) {
      console.error(e);
      alert("Fehler beim Reparieren der Push-Benachrichtigungen. Bitte prüfe die Browser-Berechtigungen und Firestore-Regeln.");
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
        alert("Push-Benachrichtigungen aktiviert!");
      } else if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        alert("Benachrichtigungen sind im Browser blockiert. Bitte erlaube Push-Benachrichtigungen in den Browser-/Website-Einstellungen.");
      } else {
        alert("Push-Benachrichtigungen konnten nicht aktiviert werden. Bitte prÃ¼fe die Browser-Berechtigungen, den Service Worker und die Firestore-Regeln.");
      }
    } catch (e: any) {
      console.error(e);
      alert(
        `Fehler beim Aktivieren der Push-Benachrichtigungen: ${
          e?.message || "Bitte prÃ¼fe die Browser-Berechtigungen und Firestore-Regeln."
        }`
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
      setDbUser((prev: any) => ({ ...prev, username: editUsername, avatar_url: editAvatarUrl }));
      setIsEditingProfile(false);
    } catch (e) {
      console.error(e);
      alert("Fehler beim Speichern");
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!dbUser || Object.keys(aniListDetails).length === 0) return;

    // Filter valid works, sort by score descending, take top 10
    const topWorks = allWorks
      .filter(w => aniListDetails[w.work_id]?.type === contentType && w.status !== "PLANNING" && (w.evaluation?.overallScore || 0) > 0)
      .sort((a, b) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0))
      .slice(0, 9)
      .map(w => ({
        id: w.work_id,
        details: {
          ...aniListDetails[w.work_id],
          userScore: w.evaluation?.overallScore
        }
      }));

    setFavItems(topWorks);
  }, [contentType, dbUser, aniListDetails, allWorks]);

  const ratedWorks = useMemo(() => {
    return allWorks
      .filter(
        (w) =>
          aniListDetails[w.work_id]?.type === contentType &&
          (w.evaluation?.overallScore || 0) > 0 &&
          (!onlyMalOpen || !w.mal_rated)
      )
      .sort((a, b) => (b.evaluation?.overallScore || 0) - (a.evaluation?.overallScore || 0));
  }, [allWorks, aniListDetails, contentType, onlyMalOpen]);

  const watchedAnimeCount = allWorks.filter(w => w.status === "COMPLETED" && aniListDetails[w.work_id]?.type === "ANIME").length;
  const readMangaCount = allWorks.filter(w => w.status === "COMPLETED" && aniListDetails[w.work_id]?.type === "MANGA").length;

  return (
    <div className="flex flex-col gap-6 px-4 pt-6 pb-24 max-w-lg mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <UserIcon className="text-blue-500" /> 
          Profil
        </h2>
        <div className="flex items-center gap-4">
          <button className="text-gray-400 hover:text-white transition">
            <Settings size={20} />
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-800 bg-[#1a1d24] p-6 shadow-lg relative">
        {user && (
          <button 
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
        
        <div className="h-24 w-24 rounded-full bg-gray-800 flex items-center justify-center text-3xl font-bold text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.5)] overflow-hidden">
          {dbUser?.avatar_url ? (
            <img src={dbUser.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            dbUser?.username?.[0]?.toUpperCase() || auth?.currentUser?.email?.[0]?.toUpperCase() || "U"
          )}
        </div>
        <div className="text-center">
          <h3 className="text-lg font-bold">{dbUser?.username || user?.displayName || "AniPulse User"}</h3>
          <p className="text-sm text-gray-400">{user?.email || "Nicht angemeldet"}</p>
        </div>

        {user ? (
          <button 
            onClick={handleLogout}
            className="mt-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-900/20 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-900/40"
          >
            <LogOut size={16} /> Abmelden
          </button>
        ) : (
          <Link 
            href="/login"
            className="mt-4 flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2 text-sm font-bold text-white transition hover:bg-blue-700 shadow-lg"
          >
            <LogIn size={16} /> Jetzt Einloggen
          </Link>
        )}
      </div>

      <ProfileStats allWorks={allWorks} aniListDetails={aniListDetails} />

      {user && (
        <section className="bg-[#1a1d24] border border-gray-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Bell size={20} className="text-blue-500" />
              Push-Benachrichtigungen
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              {isPushEnabled && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!user) return;
                    setIsSaving(true);
                    try {
                      // Ensure current device token is registered before sending test pushes
                      await requestForToken(user.uid).catch(() => {});

                      const testScenarios = [
                        {
                          type: "releases",
                          tag: `test-1-anime-release-${Date.now()}`,
                          title: "[Test 1/10 · Anime-Release] Neue Folge verfügbar!",
                          body: "Episode 12 von Solo Leveling Season 2 ist jetzt online.",
                          link: "/calendar",
                        },
                        {
                          type: "releases",
                          tag: `test-2-manga-release-${Date.now()}`,
                          title: "[Test 2/10 · Manga-Release] Neues Kapitel verfügbar!",
                          body: "Kapitel 1140 von One Piece ist jetzt online.",
                          link: "/calendar",
                        },
                        {
                          type: "releases",
                          tag: `test-3-wishlist-release-${Date.now()}`,
                          title: "[Test 3/10 · Wunschliste -> Aktiv] 🎉 Jetzt verfügbar!",
                          body: "Chainsaw Man Movie: Reze Arc ist erschienen und wurde in deine Aktiv-Liste verschoben!",
                          link: "/library",
                        },
                        {
                          type: "social",
                          tag: `test-4-review-list-${Date.now()}`,
                          title: "[Test 4/10 · Neues Review] Neues Review von Lugga! 🌟",
                          body: "Lugga hat 3 Folgen/Kapitel bewertet (Frieren Ep. 28: 10/10 · Dandadan Ep. 12: 9.5/10).",
                          link: "/feed",
                        },
                        {
                          type: "social",
                          tag: `test-5-episode-thread-${Date.now()}`,
                          title: "[Test 5/10 · Episoden-Thread] Neuer Thread in Jujutsu Kaisen (Folge 24)",
                          body: "Lugga hat eine Diskussion zu Folge 24 gestartet.",
                          link: "/feed",
                        },
                        {
                          type: "social",
                          tag: `test-6-rating-${Date.now()}`,
                          title: "[Test 6/10 · Werk-Bewertung] Neue Gesamtbewertung",
                          body: "Lugga hat Attack on Titan insgesamt mit 9.8/10 bewertet.",
                          link: "/feed",
                        },
                        {
                          type: "social",
                          tag: `test-7-weekly-ranking-${Date.now()}`,
                          title: "[Test 7/10 · Wochen-Ranking] Neues Wochen-Ranking!",
                          body: "Lugga hat sein neues Anime-Wochen-Ranking veröffentlicht.",
                          link: "/feed",
                        },
                        {
                          type: "replies",
                          tag: `test-8-review-reply-${Date.now()}`,
                          title: "[Test 8/10 · Antwort/Meinung] Lugga zu deinem Review (Folge 12)",
                          body: "„Stimme dir komplett zu, das Pacing und die Animation am Ende waren eine glatte 10/10!“",
                          link: "/feed",
                        },
                        {
                          type: "likes",
                          tag: `test-9-comment-like-${Date.now()}`,
                          title: "[Test 9/10 · Kommentar-Like] Lugga gefällt deine Meinung in Frieren",
                          body: "„Beste Folge der gesamten Staffel!“",
                          link: "/feed",
                        },
                        {
                          type: "likes",
                          tag: `test-10-work-upvote-${Date.now()}`,
                          title: "[Test 10/10 · Upvote] Neuer Like auf deinen Werk-Kommentar",
                          body: "Jemand hat deinen Kommentar zu Kapitel 180 gelikt!",
                          link: "/feed",
                        },
                      ];

                      // Short 3-second countdown so user can optionally lock their phone screen to test Lock-Screen delivery
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
                            forceNotification: true,
                          }),
                        });
                        const data = await res.json();
                        if (data.success && data.successCount > 0) {
                          totalSent++;
                        }
                        // Slight stagger (350ms) so Android doesn't drop rapid burst notifications
                        if (i < testScenarios.length - 1) {
                          await new Promise((r) => setTimeout(r, 350));
                        }
                      }

                      if (totalSent > 0) {
                        alert(
                          `${totalSent}/10 Test-Push-Benachrichtigungen (alle 10 Kategorien) wurden an dein Gerät gesendet!`
                        );
                      } else {
                        alert(
                          "Dein gespeicherter Push-Token war abgelaufen. Bitte klicke einmal auf 'Reparieren', um dieses Gerät neu zu verbinden."
                        );
                      }
                    } catch (err) {
                      console.error(err);
                      alert("Fehler beim Senden der Test-Benachrichtigungen.");
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  disabled={isSaving}
                  className="text-[11px] bg-blue-600/20 hover:bg-blue-600/35 text-blue-300 border border-blue-500/30 px-2.5 py-1 rounded-lg font-semibold transition"
                >
                  {isSaving ? "Sende 10 Tests (3s)..." : "Alle 10 Push-Arten testen"}
                </button>
              )}
              {isPushEnabled && (
                <button
                  type="button"
                  onClick={handleRepairPush}
                  disabled={isSaving}
                  className="text-[11px] bg-amber-600/20 hover:bg-amber-600/35 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-lg font-semibold transition"
                >
                  {isSaving ? "..." : "Reparieren"}
                </button>
              )}
            </div>
          </div>
          {isPushEnabled && (
            <p className="text-[11px] text-gray-400 mb-3 leading-relaxed">
              💡 <strong>Tipp für den Sperrbildschirm-Test:</strong> Nach Klick auf{" "}
              <span className="text-blue-300 font-semibold">„Alle 10 Push-Arten testen“</span> startet ein{" "}
              <strong>3-Sekunden-Countdown</strong> – sperre in diesen 3 Sekunden direkt dein Handy, damit du alle 10 Benachrichtigungen live auf dem Lock-Screen siehst!
            </p>
          )}

          {typeof window !== "undefined" &&
            typeof Notification !== "undefined" &&
            Notification.permission !== "granted" &&
            isPushEnabled && (
              <div className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 flex items-center justify-between gap-2">
                <span>
                  Auf diesem Gerät/Browser sind Push-Mitteilungen noch nicht erlaubt.
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
                Erlaube Push-Benachrichtigungen, um über neue Folgen, Kapitel und Reviews informiert zu werden.
              </p>
              <button 
                onClick={enablePush}
                disabled={isSaving}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition disabled:opacity-50"
              >
                {isSaving ? "Aktiviert..." : "Push-Benachrichtigungen aktivieren"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-white">Neue Folgen &amp; Kapitel</div>
                  <div className="text-xs text-gray-500">Für Werke aus deiner Bibliothek</div>
                </div>
                <button 
                  onClick={() => handleToggle("releases")}
                  className={`w-12 h-6 rounded-full transition-colors relative ${notifySettings.releases ? "bg-blue-500" : "bg-gray-700"}`}
                >
                  <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${notifySettings.releases ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-white">Likes &amp; Reaktionen</div>
                  <div className="text-xs text-gray-500">Wenn jemand auf deine Beiträge reagiert</div>
                </div>
                <button 
                  onClick={() => handleToggle("likes")}
                  className={`w-12 h-6 rounded-full transition-colors relative ${notifySettings.likes ? "bg-blue-500" : "bg-gray-700"}`}
                >
                  <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${notifySettings.likes ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-white">Antworten &amp; Meinungen</div>
                  <div className="text-xs text-gray-500">Auf deine Reviews und Kommentare</div>
                </div>
                <button 
                  onClick={() => handleToggle("replies")}
                  className={`w-12 h-6 rounded-full transition-colors relative ${notifySettings.replies ? "bg-blue-500" : "bg-gray-700"}`}
                >
                  <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${notifySettings.replies ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-white">Review Feed</div>
                  <div className="text-xs text-gray-500">Neue Reviews &amp; Beiträge der Community</div>
                </div>
                <button 
                  onClick={() => handleToggle("social")}
                  className={`w-12 h-6 rounded-full transition-colors relative ${notifySettings.social ? "bg-blue-500" : "bg-gray-700"}`}
                >
                  <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${notifySettings.social ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {user && (
        <section>
          <h3 className="mb-3 text-lg font-bold flex items-center gap-2">
            <Star className="text-blue-500" />
            Meine All-Time Favoriten ({contentType})
          </h3>
          <p className="text-xs text-gray-400 mb-4">Deine 10 bestbewerteten Werke. Wird automatisch berechnet.</p>
          
          {favItems.length === 0 ? (
            <div className="text-sm text-gray-500 border border-gray-800 bg-[#1a1d24] rounded-xl p-6 text-center">
              Du hast noch keine Werke bewertet.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
              {favItems.map((item, index) => (
                <FavoriteItem key={item.id} id={item.id} index={index} workDetails={item.details} />
              ))}
            </div>
          )}
        </section>
      )}

      {user && (
        <section className="bg-[#1a1d24] border border-gray-800 rounded-2xl p-4 shadow-lg">
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
                  : "bg-[#141a29] border-gray-700 text-gray-400 hover:text-white"
              }`}
            >
              Nur AniList/MAL offen
            </button>
          </div>

          {ratedWorks.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">
              {onlyMalOpen
                ? "Alle bewerteten Werke sind bereits auf AniList/MAL markiert."
                : "Keine bewerteten Werke fÃ¼r diese Kategorie vorhanden."}
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
              {ratedWorks.map((w) => {
                const details = aniListDetails[w.work_id];
                const title =
                  details?.title?.english ||
                  details?.title?.romaji ||
                  `Werk #${w.work_id}`;
                const cover = details?.coverImage?.large || details?.coverImage?.extraLarge;
                const score = w.evaluation?.overallScore || 0;
                const rewatch = w.evaluation?.rewatchPotential || 0;

                return (
                  <div
                    key={w.work_id}
                    className="flex items-center gap-3 rounded-xl border border-gray-800 bg-[#141a29] p-2.5 hover:border-gray-700 transition-colors"
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
                        className="text-sm font-semibold text-white hover:text-blue-400 transition-colors line-clamp-1 block"
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

                    <span className="text-sm font-bold text-blue-400 shrink-0 tabular-nums">
                      â˜… {score.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-3 text-lg font-bold">Statistiken</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-4 text-center">
            <span className="block text-2xl font-bold text-blue-500">{watchedAnimeCount}</span>
            <span className="text-xs text-gray-400">Gesehene Anime</span>
          </div>
          <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-4 text-center">
            <span className="block text-2xl font-bold text-blue-500">{readMangaCount}</span>
            <span className="text-xs text-gray-400">Gelesene Manga</span>
          </div>
        </div>
      </section>

      {/* Profil Edit Modal */}
      {isEditingProfile && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveProfile} className="bg-[#1a1d24] border border-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-lg font-bold mb-4">Profil bearbeiten</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1">Benutzername</label>
                <input 
                  type="text" 
                  value={editUsername} 
                  onChange={e => setEditUsername(e.target.value)}
                  className="w-full bg-[#141a29] border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-1">Profilbild</label>
                
                <div className="flex flex-col items-center gap-3">
                  <div className="h-20 w-20 rounded-full bg-gray-800 flex items-center justify-center overflow-hidden border border-gray-700">
                    {editAvatarUrl ? (
                      <img src={editAvatarUrl} alt="Preview" className="w-full h-full object-cover" />
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
                      className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold py-2 rounded-lg transition"
                    >
                      Bild vom Handy wÃ¤hlen
                    </button>
                    {editAvatarUrl && (
                      <button 
                        type="button"
                        onClick={() => setEditAvatarUrl("")}
                        className="bg-red-900/50 hover:bg-red-900 text-red-400 text-xs font-bold px-3 py-2 rounded-lg transition"
                      >
                        Entfernen
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 w-full text-center mt-1">Bild wird automatisch optimiert gespeichert.</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button 
                type="button" 
                onClick={() => setIsEditingProfile(false)}
                className="px-4 py-2 text-sm font-bold text-gray-400 hover:text-white"
              >
                Abbrechen
              </button>
              <button 
                type="submit" 
                disabled={isSaving}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-sm transition"
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

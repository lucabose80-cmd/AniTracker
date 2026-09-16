"use client";

import { User as UserIcon, Settings, LogOut, LogIn, Bell, Star } from "lucide-react";
import { auth } from "@/lib/firebase";
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getUserProfile, updateNotificationSettings, updateTop9List } from "@/lib/db/users";
import { requestForToken } from "@/lib/fcm";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";
import { useAppStore } from "@/lib/store";

function FavoriteItem({ id, index, workDetails }: { id: string, index: number, workDetails?: any }) {
  return (
    <div className={`w-24 shrink-0 aspect-[3/4] relative rounded-xl bg-[#1a1d24] border border-gray-800 flex items-center justify-center font-bold text-gray-500 overflow-hidden shadow-lg`}>
      <span className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 font-bold text-white shadow-md z-10 border border-white/20">
        {index + 1}
      </span>
      
      {workDetails ? (
        <Link href={`/work/${id}`} className="absolute inset-0 block h-full w-full group">
          <img src={workDetails.coverImage?.extraLarge || workDetails.coverImage?.large} alt="Cover" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          <div className="absolute bottom-0 w-full bg-black/80 backdrop-blur-md text-[10px] text-center text-blue-400 py-1 font-bold">
            ★ {workDetails.userScore?.toFixed(1) || "?"}
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
  
  const [notifySettings, setNotifySettings] = useState({
    releases: true,
    likes: true,
    replies: true,
    social: true
  });
  
  const [allWorks, setAllWorks] = useState<any[]>([]);
  const [aniListDetails, setAniListDetails] = useState<Record<string, any>>({});
  const [favItems, setFavItems] = useState<any[]>([]);

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

  const enablePush = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const token = await requestForToken(user.uid);
      if (token) {
        setIsPushEnabled(true);
        alert("Push-Benachrichtigungen aktiviert!");
      }
    } catch (e) {
      console.error(e);
      alert("Fehler beim Aktivieren der Push-Benachrichtigungen.");
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
      .slice(0, 10)
      .map(w => ({
        id: w.work_id,
        details: {
          ...aniListDetails[w.work_id],
          userScore: w.evaluation?.overallScore
        }
      }));

    setFavItems(topWorks);
  }, [contentType, dbUser, aniListDetails, allWorks]);

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

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-800 bg-[#1a1d24] p-6 shadow-lg">
        <div className="h-24 w-24 rounded-full bg-blue-600 flex items-center justify-center text-3xl font-bold text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.5)]">
          {auth?.currentUser?.email?.[0].toUpperCase() || "U"}
        </div>
        <div className="text-center">
          <h3 className="text-lg font-bold">{user?.displayName || "AniTracker User"}</h3>
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

      {user && (
        <section className="bg-[#1a1d24] border border-gray-800 rounded-2xl p-5 shadow-lg">
          <h3 className="mb-4 text-lg font-bold flex items-center gap-2">
            <Bell size={20} className="text-blue-500" />
            Push-Benachrichtigungen
          </h3>
          
          {!isPushEnabled ? (
            <div className="text-center">
              <p className="text-xs text-gray-400 mb-4">
                Erlaube Push-Benachrichtigungen, um über neue Folgen und Aktivitäten informiert zu werden.
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
                  <div className="text-sm font-bold text-white">Neue Folgen & Kapitel</div>
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
                  <div className="text-sm font-bold text-white">Likes & Reaktionen</div>
                  <div className="text-xs text-gray-500">Wenn jemand deine Kommentare mag</div>
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
                  <div className="text-sm font-bold text-white">Antworten</div>
                  <div className="text-xs text-gray-500">Auf deine Kommentare</div>
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
                  <div className="text-sm font-bold text-white">Social Feed</div>
                  <div className="text-xs text-gray-500">Neue Beiträge der Community</div>
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
            <div className="flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
              {favItems.map((item, index) => (
                <div key={item.id} className="snap-center">
                  <FavoriteItem id={item.id} index={index} workDetails={item.details} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-3 text-lg font-bold">Statistiken</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-4 text-center">
            <span className="block text-2xl font-bold text-blue-500">0</span>
            <span className="text-xs text-gray-400">Gesehene Anime</span>
          </div>
          <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-4 text-center">
            <span className="block text-2xl font-bold text-blue-500">0</span>
            <span className="text-xs text-gray-400">Gelesene Manga</span>
          </div>
        </div>
      </section>
    </div>
  );
}

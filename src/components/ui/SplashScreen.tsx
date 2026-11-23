"use client";

import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { getUserProfile } from "@/lib/db/users";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniList, fetchAniListBatch, GET_TRENDING_WORKS } from "@/lib/anilist";
import { AniListMedia } from "@/types/anilist";

export function SplashScreen({ children }: { children: React.ReactNode }) {
  // Start hidden on initial render if already dismissed in this session; avoid flash via mounted check
  const [splashState, setSplashState] = useState<"checking" | "visible" | "hidden">("checking");
  const [animateOut, setAnimateOut] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [authLoaded, setAuthLoaded] = useState(!auth);
  const [bgImages, setBgImages] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      const dismissed =
        typeof window !== "undefined" &&
        window.sessionStorage.getItem("splashDismissed") === "true";
      setSplashState(dismissed ? "hidden" : "visible");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (splashState !== "visible" || !auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoaded(true);
      if (currentUser) {
        getUserProfile(currentUser.uid)
          .then((p) => {
            if (p?.username) setProfileName(p.username);
          })
          .catch(() => {});
      }
    });
    return () => unsubscribe();
  }, [splashState]);

  // Only fetch collage background images when Splash is actually visible (saves Firestore & AniList reads!)
  useEffect(() => {
    if (splashState !== "visible" || !authLoaded) return;
    let cancelled = false;

    async function loadBgImages() {
      let workIds: string[] = [];
      if (user) {
        try {
          const works = await getAllUserWorks(user.uid);
          workIds = works
            .filter((w) => w.status === "CURRENT")
            .slice(0, 9)
            .map((w) => w.work_id);
        } catch (e) {
          console.error(e);
        }
      }

      if (cancelled) return;

      if (workIds.length > 0) {
        try {
          const mediaList = await fetchAniListBatch(
            workIds.map((id) => parseInt(id, 10))
          );
          if (cancelled) return;
          const images = mediaList
            .map((m) => m.coverImage?.extraLarge || m.coverImage?.large)
            .filter((img): img is string => Boolean(img));
          setBgImages(images);
        } catch (e) {
          console.error(e);
        }
      } else {
        try {
          const data = await fetchAniList<{ Page?: { media?: AniListMedia[] } }>(
            GET_TRENDING_WORKS,
            { type: "ANIME", page: 1, perPage: 10 }
          );
          if (cancelled) return;
          const images = (data?.Page?.media || [])
            .map((m) => m.coverImage?.extraLarge || m.coverImage?.large)
            .filter((img): img is string => Boolean(img));
          setBgImages(images);
        } catch {
          // ignore offline fallback
        }
      }
    }
    loadBgImages();
    return () => {
      cancelled = true;
    };
  }, [splashState, authLoaded, user]);

  const handleStart = () => {
    setAnimateOut(true);
    try {
      sessionStorage.setItem("splashDismissed", "true");
    } catch {
      // ignore
    }
    setTimeout(() => {
      setSplashState("hidden");
    }, 600);
  };

  if (splashState !== "visible") {
    return <>{children}</>;
  }

  return (
    <>
      <div
        className={`transition-all duration-700 ${
          !animateOut
            ? "blur-md scale-95 opacity-50"
            : "blur-0 scale-100 opacity-100"
        }`}
      >
        {children}
      </div>

      <div
        className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-app overflow-hidden transition-all duration-700 ${
          animateOut
            ? "scale-110 opacity-0 pointer-events-none"
            : "scale-100 opacity-100"
        }`}
      >
        {bgImages.length > 0 && (
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="grid grid-cols-3 grid-rows-3 w-full h-full gap-1 opacity-60">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="relative w-full h-full">
                  {bgImages[i % bgImages.length] && (
                    <img
                      src={bgImages[i % bgImages.length]}
                      alt="Background"
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="absolute inset-0 bg-app/50" />
            <div className="absolute inset-0 bg-gradient-to-t from-app/80 via-transparent to-app/80" />
          </div>
        )}

        <div className="flex flex-col items-center space-y-6 relative z-10">
          <img
            src="/anipulse-192x192.png"
            alt="AniPulse Logo"
            className="w-20 h-20 rounded-2xl shadow-accent-glow border border-accent-border object-cover"
          />
          <h1 className="text-5xl font-extrabold tracking-tighter text-white">
            <span className="bg-accent-gradient-text">Ani</span>Pulse
          </h1>
          <p className="text-gray-400 text-sm max-w-xs text-center">
            Dein Tracker für Anime, Manga und Manhwa mit tiefgehenden Bewertungen.
          </p>

          <div className="mt-12 flex flex-col items-center gap-4 min-h-[120px]">
            {!authLoaded ? (
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent border-t-transparent" />
            ) : user ? (
              <div className="flex flex-col items-center gap-4">
                <p className="text-sm font-semibold text-accent-text">
                  Willkommen zurück,{" "}
                  {profileName || user.displayName || user.email?.split("@")[0]}!
                </p>
                <button
                  type="button"
                  onClick={handleStart}
                  className="group relative overflow-hidden rounded-full bg-accent hover:bg-accent-hover px-12 py-4 text-lg font-bold text-white shadow-accent-glow transition-all hover:scale-105 active:scale-95"
                >
                  <span className="relative z-10">START</span>
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    handleStart();
                    setTimeout(() => router.push("/login"), 300);
                  }}
                  className="group relative flex items-center gap-2 overflow-hidden rounded-full bg-accent hover:bg-accent-hover px-12 py-4 text-lg font-bold text-white shadow-accent-glow transition-all hover:scale-105 active:scale-95"
                >
                  <LogIn size={20} className="relative z-10" />
                  <span className="relative z-10">Einloggen / Registrieren</span>
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

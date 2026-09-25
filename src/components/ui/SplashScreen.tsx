"use client";

import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { getUserProfile } from "@/lib/db/users";
import { getAllUserWorks } from "@/lib/db/works";
import { fetchAniListBatch } from "@/lib/anilist";

export function SplashScreen({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(true);
  const [animateOut, setAnimateOut] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!auth) {
      setAuthLoaded(true);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoaded(true);
    });
    return () => unsubscribe();
  }, []);

  const [bgImages, setBgImages] = useState<string[]>([]);

  useEffect(() => {
    async function loadBgImages() {
      if (!authLoaded) return;
      
      let workIds: string[] = [];
      if (user) {
        try {
          const works = await getAllUserWorks(user.uid);
          workIds = works.filter((w: any) => w.status === "CURRENT").slice(0, 9).map((w: any) => w.work_id);
        } catch (e) {
          console.error(e);
        }
      }
      
      if (workIds.length > 0) {
        try {
          const mediaList = await fetchAniListBatch(workIds.map(id => parseInt(id, 10)));
          const images = mediaList.map((m: any) => m.coverImage?.extraLarge || m.coverImage?.large).filter(Boolean);
          setBgImages(images);
        } catch (e) {
          console.error(e);
        }
      } else {
        // Fallback to trending
        try {
           const { fetchAniList, GET_TRENDING_WORKS } = await import("@/lib/anilist");
           const data = await fetchAniList(GET_TRENDING_WORKS, { type: "ANIME", page: 1, perPage: 10 });
           const images = data.Page.media.map((m: any) => m.coverImage?.extraLarge || m.coverImage?.large).filter(Boolean);
           setBgImages(images);
        } catch(e) {}
      }
    }
    loadBgImages();
  }, [authLoaded, user]);



  // We can just use a simple timeout or a "START" button as requested.
  // The user requested: 'Splash Screen with zoom-in pull animation on "START".'
  
  const handleStart = () => {
    setAnimateOut(true);
    setTimeout(() => {
      setShowSplash(false);
    }, 600); // Wait for animation to finish
  };

  if (!showSplash) {
    return <>{children}</>;
  }

  return (
    <>
      {/* App content in background, hidden/blurred initially */}
      <div className={`transition-all duration-700 ${!animateOut ? 'blur-md scale-95 opacity-50' : 'blur-0 scale-100 opacity-100'}`}>
        {children}
      </div>

      {/* Splash Overlay */}
      <div 
        className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0f1115] overflow-hidden transition-all duration-700 ${
          animateOut ? "scale-110 opacity-0 pointer-events-none" : "scale-100 opacity-100"
        }`}
      >
        {/* Collage Background */}
        {bgImages.length > 0 && (
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-40">
            <div className="grid grid-cols-3 grid-rows-3 w-full h-full gap-1">
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
            <div className="absolute inset-0 bg-gradient-to-t from-[#0f1115] via-[#0f1115]/90 to-[#0f1115]/50" />
            <div className="absolute inset-0 bg-black/50" />
          </div>
        )}

        <div className="flex flex-col items-center space-y-8 relative z-10">
          <h1 className="text-5xl font-extrabold tracking-tighter text-white">
            <span className="text-blue-600">Ani</span>Tracker
          </h1>
          <p className="text-gray-400 text-sm max-w-xs text-center">
            Dein Tracker für Anime, Manga und Manhwa mit tiefgehenden Bewertungen.
          </p>
          
          <div className="mt-12 flex flex-col items-center gap-4 min-h-[120px]">
            {!authLoaded ? (
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            ) : user ? (
              <div className="flex flex-col items-center gap-4">
                <p className="text-sm font-semibold text-blue-400">Willkommen zurück, {user.displayName || user.email?.split("@")[0]}!</p>
                <button
                  onClick={handleStart}
                  className="group relative overflow-hidden rounded-full bg-blue-600 px-12 py-4 text-lg font-bold text-white shadow-[0_0_40px_-10px_rgba(37,99,235,0.5)] transition-all hover:scale-105 hover:shadow-[0_0_60px_-15px_rgba(37,99,235,0.7)] active:scale-95"
                >
                  <span className="relative z-10">START</span>
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={() => {
                    handleStart();
                    setTimeout(() => router.push("/login"), 300);
                  }}
                  className="group relative flex items-center gap-2 overflow-hidden rounded-full bg-blue-600 px-12 py-4 text-lg font-bold text-white shadow-[0_0_40px_-10px_rgba(37,99,235,0.5)] transition-all hover:scale-105 hover:shadow-[0_0_60px_-15px_rgba(37,99,235,0.7)] active:scale-95"
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

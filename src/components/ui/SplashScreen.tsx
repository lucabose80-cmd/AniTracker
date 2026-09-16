"use client";

import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";

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
        className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0f1115] transition-all duration-700 ${
          animateOut ? "scale-110 opacity-0 pointer-events-none" : "scale-100 opacity-100"
        }`}
      >
        <div className="flex flex-col items-center space-y-8">
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

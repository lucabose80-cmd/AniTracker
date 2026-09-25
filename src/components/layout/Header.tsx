"use client";

import { useAppStore } from "@/lib/store";
import { Moon, Sun, User as UserIcon, LogIn, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { getUserProfile } from "@/lib/db/users";

export function Header() {
  const { contentType, toggleContentType } = useAppStore();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const p = await getUserProfile(currentUser.uid);
        setProfile(p);
      } else {
        setProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-gray-800 bg-[#0f1115]/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <h1 className="text-xl font-bold text-white">
          <span className="text-blue-600">Ani</span>Tracker
        </h1>

        <div className="flex items-center gap-4">
          <button
            onClick={toggleContentType}
            className="flex items-center gap-2 rounded-full bg-[#1a1d24] p-1 shadow-inner border border-gray-800 transition-all duration-300"
          >
            <div
              className={`flex h-8 w-20 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300 ${
                contentType === "ANIME"
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-gray-400"
              }`}
            >
              Anime
            </div>
            <div
              className={`flex h-8 w-20 items-center justify-center rounded-full text-xs font-semibold transition-all duration-300 ${
                contentType === "MANGA"
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-gray-400"
              }`}
            >
              Manga
            </div>
          </button>
          
          <Link href="/search" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1a1d24] text-gray-400 border border-gray-800 hover:text-white transition">
            <Search size={16} />
          </Link>

          {user ? (
            <Link href="/profile" className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white font-bold shadow-md hover:bg-blue-700 transition overflow-hidden">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                user.email?.[0].toUpperCase() || "U"
              )}
            </Link>
          ) : (
            <Link href="/login" className="flex items-center gap-1 text-sm font-semibold text-blue-500 hover:text-blue-400 transition">
              <LogIn size={18} />
              <span className="hidden sm:inline">Login</span>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

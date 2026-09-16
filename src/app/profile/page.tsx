"use client";

import { User, Settings, LogOut } from "lucide-react";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";

export default function ProfilePage() {
  const router = useRouter();

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
      router.push("/login");
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 pt-6">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <User className="text-blue-500" /> 
          Profil
        </h2>
        <button className="text-gray-400 hover:text-white transition">
          <Settings size={20} />
        </button>
      </div>

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-gray-800 bg-[#1a1d24] p-6 shadow-lg">
        <div className="h-24 w-24 rounded-full bg-blue-600 flex items-center justify-center text-3xl font-bold text-white shadow-[0_0_15px_-3px_rgba(37,99,235,0.5)]">
          {auth?.currentUser?.email?.[0].toUpperCase() || "U"}
        </div>
        <div className="text-center">
          <h3 className="text-lg font-bold">{auth?.currentUser?.displayName || "AniTracker User"}</h3>
          <p className="text-sm text-gray-400">{auth?.currentUser?.email || "Nicht angemeldet"}</p>
        </div>

        <button 
          onClick={handleLogout}
          className="mt-4 flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-900/20 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-900/40"
        >
          <LogOut size={16} /> Abmelden
        </button>
      </div>
      
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

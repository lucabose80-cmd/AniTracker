"use client";

import { Users, MessageSquare } from "lucide-react";

export default function SocialPage() {
  return (
    <div className="flex flex-col gap-6 px-4 pt-6">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Users className="text-blue-500" /> 
        Social Feed
      </h2>
      
      <div className="grid gap-4">
        <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center font-bold">A</div>
            <div>
              <p className="text-sm font-semibold">Alex <span className="text-gray-400 font-normal">hat bewertet:</span></p>
              <p className="text-xs text-blue-400">Solo Leveling</p>
            </div>
            <div className="ml-auto flex items-center gap-1 text-yellow-500 font-bold">
              ★ 9.5
            </div>
          </div>
          <p className="text-sm text-gray-300">Die Animationen in der neuesten Episode waren absolut atemberaubend!</p>
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            <button className="flex items-center gap-1 hover:text-blue-400 transition"><MessageSquare size={14} /> Antworten</button>
          </div>
        </div>
        
        <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-4 text-center text-gray-400">
          <p>Folge anderen Nutzern, um deren Aktivitäten hier zu sehen.</p>
        </div>
      </div>
    </div>
  );
}

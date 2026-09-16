"use client";

import { useAppStore } from "@/lib/store";
import { Library as LibraryIcon, Search, LayoutGrid } from "lucide-react";

export default function LibraryPage() {
  const { contentType } = useAppStore();

  return (
    <div className="flex flex-col gap-6 px-4 pt-6">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <LibraryIcon className="text-blue-500" /> 
        Meine Bibliothek
      </h2>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
        <input 
          type="text" 
          placeholder={`${contentType} suchen...`}
          className="w-full rounded-lg border border-gray-800 bg-[#1a1d24] p-3 pl-10 text-white focus:border-blue-500 focus:outline-none"
        />
      </div>

      <section>
        <h3 className="mb-3 text-lg font-bold flex items-center gap-2">
          <LayoutGrid size={18} className="text-gray-400" />
          Top 9 (Priority)
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3,4,5,6,7,8,9].map((i) => (
            <div key={i} className="aspect-[3/4] rounded bg-[#1a1d24] border border-gray-800 flex items-center justify-center text-gray-600 font-bold shadow-inner">
              {i}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

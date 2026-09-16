"use client";

import { useAppStore } from "@/lib/store";
import { Calendar as CalendarIcon, Clock } from "lucide-react";

export default function CalendarPage() {
  const { contentType } = useAppStore();
  const days = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

  return (
    <div className="flex flex-col gap-6 px-4 pt-6">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <CalendarIcon className="text-blue-500" /> 
        Release Kalender
      </h2>
      
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {days.map((day, i) => (
          <button 
            key={day} 
            className={`flex flex-col items-center justify-center rounded-xl min-w-[3rem] p-2 transition ${
              i === 2 ? "bg-blue-600 text-white" : "bg-[#1a1d24] text-gray-400 border border-gray-800"
            }`}
          >
            <span className="text-xs">{day}</span>
            <span className="text-sm font-bold">{12 + i}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 mt-2">
        <div className="rounded-xl border border-gray-800 bg-[#1a1d24] p-4 text-center text-gray-400">
          <Clock className="mx-auto mb-2 opacity-50" size={32} />
          <p>Hier erscheinen die täglichen {contentType === "ANIME" ? "Episoden" : "Kapitel"}-Releases.</p>
          <p className="text-xs mt-1">In Kürze verfügbar.</p>
        </div>
      </div>
    </div>
  );
}

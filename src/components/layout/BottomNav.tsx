"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Calendar, Users, Library, User } from "lucide-react";
import { useAppStore } from "@/lib/store";

const navItems = [
  { name: "Home", href: "/", icon: Home },
  { name: "Social", href: "/feed", icon: Users },
  { name: "Kalender", href: "/calendar", icon: Calendar },
  { name: "Bibliothek", href: "/library", icon: Library },
  { name: "Profil", href: "/profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const unreadCount = useAppStore(state => state.unreadNotifications);

  return (
    <nav className="fixed bottom-0 left-0 z-50 w-full border-t border-gray-800 bg-[#0f1115]/95 pb-safe pt-2 backdrop-blur-md px-2">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => {
                useAppStore.getState().triggerReload();
              }}
              className={`flex flex-col items-center justify-center space-y-1 relative ${
                isActive ? "text-blue-600" : "text-gray-400 hover:text-gray-300"
              }`}
            >
              <div className="relative">
                <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                {item.name === "Social" && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-2 bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

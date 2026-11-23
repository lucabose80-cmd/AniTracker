"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Calendar, Library, Search, User } from "lucide-react";
import { useAppStore } from "@/lib/store";

const navItems = [
  { name: "Home", href: "/", icon: Home },
  { name: "Kalender", href: "/calendar", icon: Calendar },
  { name: "Bibliothek", href: "/library", icon: Library },
  { name: "Suche", href: "/search", icon: Search },
  { name: "Profil", href: "/profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 z-50 w-full border-t border-gray-800 bg-app/95 pb-safe pt-2 backdrop-blur-md px-2">
      <div className="mx-auto flex h-14 max-w-md items-center justify-between px-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => {
                // Only trigger a manual reload when tapping the already-active tab
                if (pathname === item.href) {
                  useAppStore.getState().triggerReload();
                }
              }}
              className={`flex flex-col items-center justify-center space-y-1 relative transition-colors ${
                isActive
                  ? "text-accent-text"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              <div className="relative">
                <Icon size={23} strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

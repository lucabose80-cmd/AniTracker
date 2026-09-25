import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { ServiceWorkerManager } from "@/components/ServiceWorkerManager";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WeebCheck",
  description: "Dein Tracker für Anime, Manga und Manhwa mit tiefgehenden Bewertungen.",
  manifest: "/manifest.json",
  icons: {
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "WeebCheck",
  },
};

export const viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#0f1115] text-white overflow-x-hidden selection:bg-blue-600/30">
        <SplashScreen>
          <Header />
          <main className="flex-1 pb-20">
            {children}
          </main>
          <BottomNav />
          <ServiceWorkerManager />
        </SplashScreen>
      </body>
    </html>
  );
}

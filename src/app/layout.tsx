import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { ServiceWorkerManager } from "@/components/ServiceWorkerManager";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ScrollToTop } from "@/components/ui/ScrollToTop";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AniPulse",
  description: "Dein Tracker für Anime, Manga und Manhwa mit tiefgehenden Bewertungen.",
  manifest: "/manifest.json",
  icons: {
    icon: "/anipulse-192x192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AniPulse",
  },
};

export const viewport = {
  themeColor: "#0f1115",
  viewportFit: "cover",
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
          <OfflineBanner />
          <main className="flex-1 pb-20">
            {children}
          </main>
          <BottomNav />
          <ScrollToTop />
          <ServiceWorkerManager />
        </SplashScreen>
      </body>
    </html>
  );
}

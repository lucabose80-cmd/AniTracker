import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { BottomNav } from "@/components/layout/BottomNav";
import { SplashScreen } from "@/components/ui/SplashScreen";
import { ServiceWorkerManager } from "@/components/ServiceWorkerManager";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { ScrollToTop } from "@/components/ui/ScrollToTop";
import { FeedbackOverlay } from "@/components/ui/FeedbackOverlay";

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

export const viewport: Viewport = {
  themeColor: "#0f1115",
  viewportFit: "cover",
};

const accentInitScript = `(function(){try{var t=localStorage.getItem('anipulse_accent_theme');if(t==='blue'){document.documentElement.dataset.accent='blue';}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="de"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: accentInitScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-app text-white overflow-x-hidden">
        <SplashScreen>
          <Header />
          <OfflineBanner />
          <main className="flex-1 pb-24">
            {children}
          </main>
          <BottomNav />
          <ScrollToTop />
          <FeedbackOverlay />
          <ServiceWorkerManager />
        </SplashScreen>
      </body>
    </html>
  );
}

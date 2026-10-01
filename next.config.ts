import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "s4.anilist.co" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  serverExternalPackages: ["firebase-admin"],
  env: {
    // Bake the git SHA at build-time so it's available in serverless API routes at runtime
    BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`,
    BUILD_MESSAGE: process.env.VERCEL_GIT_COMMIT_MESSAGE || "Lokaler Build",
  },
};

export default withSerwist(nextConfig);

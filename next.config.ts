import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const buildSha = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;

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
    BUILD_SHA: buildSha,
    BUILD_MESSAGE: process.env.VERCEL_GIT_COMMIT_MESSAGE || "Lokaler Build",
    NEXT_PUBLIC_BUILD_SHA: buildSha,
  },
};

export default withSerwist(nextConfig);

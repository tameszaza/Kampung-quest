import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    localPatterns: [
      // Allow local assets and cache-busted avatar URLs.
      { pathname: "**" },
    ],
    remotePatterns: [
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },
};

export default nextConfig;

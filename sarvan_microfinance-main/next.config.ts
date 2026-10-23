import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Disable optimization for .jfif files if needed
    // This ensures images are served correctly in production
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    localPatterns: [
      {
        pathname: '/login-slides/**',
        // search omitted — allows the ?v=<mtime> cache-busting query string
      },
      {
        pathname: '/Sarvam_wordmark*.png',
        // covers Sarvam_wordmark.png, Sarvam_wordmark_title.png, Sarvam_wordmark_line.png,
        // Sarvam_wordmark_sub.png — all used by components/SarvamLoginTransition.tsx
      },
      {
        pathname: '/eod*.png',
        // EOD Process welcome banner — components/utilities/EodWelcomeBanner.tsx
      },
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.r2.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '**.s3.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: '**.s3.*.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
    ],
  },
};

export default nextConfig;

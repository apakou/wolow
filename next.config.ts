import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // A05: unsafe-eval is only required during development (webpack HMR).
      // Production builds are pre-compiled and must not use eval().
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",                // required by Tailwind
      isDev
        ? "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321 https://127.0.0.1:54321 wss://127.0.0.1:54321 https://*.supabase.co wss://*.supabase.co https:"  
        : "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "img-src 'self' data:",
      "font-src 'self'",
      "worker-src 'self'",                               // required for service worker
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.100.19'],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;

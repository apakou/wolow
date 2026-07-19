import type { Metadata, Viewport } from "next";
import { Baloo_2, Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import ErrorBoundary from "@/components/ErrorBoundary";
import GlobalErrorListener from "@/components/GlobalErrorListener";
import InstallPromptPopup from "@/components/InstallPromptPopup";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Wolow",
  description: "Anonymous chat rooms share your link, get honest messages",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Wolow",
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192x192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#140A26",
  width: "device-width",
  initialScale: 1,
  // No maximumScale: pinch-zoom must stay available (WCAG 1.4.4). iOS
  // focus-zoom is avoided by keeping text inputs at 16px (text-base).
  viewportFit: "cover",
  // On-screen keyboard shrinks the layout viewport (and h-dvh) instead of
  // panning the page — keeps fixed headers/composers visible while typing.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${baloo.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full flex flex-col">
        <ErrorBoundary>
          <GlobalErrorListener />
          {children}
          <InstallPromptPopup />
        </ErrorBoundary>
        <Script id="register-sw" strategy="afterInteractive">
          {`
            if ('serviceWorker' in navigator) {
              var hostname = window.location.hostname;
              var isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
              var isProd = ${process.env.NODE_ENV === 'production'};
              if (isProd || isLocalhost) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function() {});
                });
              }
            }
          `}
        </Script>
      </body>
    </html>
  );
}

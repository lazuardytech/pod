import { DM_Sans, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import OfflineMutationProcessor from "@/shared/components/OfflineMutationProcessor";
import OfflineSyncStatus from "@/shared/components/OfflineSyncStatus";
import PWAInstallPrompt from "@/shared/components/PWAInstallPrompt";
import ServiceWorkerRegistrar from "@/shared/components/ServiceWorkerRegistrar";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import "@/lib/initCloudSync";
import "@/lib/network/initOutboundProxy";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata = {
  applicationName: "Pod",
  title: "Pod",
  description: "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    title: "Pod",
    capable: true,
    statusBarStyle: "default",
  },
};

export const viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f8f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${ibmPlexMono.variable} ${dmSans.variable}`}>
      <head>
        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/icon0.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        <meta name="apple-mobile-web-app-title" content="Pod" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#0a0a0a" />
        {/* Material Symbols Outlined — not available via next/font, loaded via CDN */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
        />
      </head>
      <body className="h-full bg-pitch-black text-porcelain custom-scrollbar">
        <ThemeProvider>
          <ServiceWorkerRegistrar />
          <OfflineMutationProcessor />
          <OfflineSyncStatus />
          <PWAInstallPrompt />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

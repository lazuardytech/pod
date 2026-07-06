import { DM_Sans, IBM_Plex_Mono, Inter } from "next/font/google";
import Script from "next/script";
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
  description:
    "One endpoint for all your AI providers. Manage keys, monitor usage, and scale effortlessly.",
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

const themeInitScript = `
  (() => {
    const root = document.documentElement;

    try {
      const storedTheme = localStorage.getItem("theme");
      const parsedTheme = storedTheme ? JSON.parse(storedTheme) : null;
      const selectedTheme = parsedTheme?.state?.theme ?? "dark";
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      const effectiveTheme = selectedTheme === "system" ? systemTheme : selectedTheme;

      root.classList.toggle("dark", effectiveTheme === "dark");
      root.classList.toggle("light", effectiveTheme !== "dark");
    } catch {
      root.classList.add("dark");
      root.classList.remove("light");
    }
  })();
`;

export default function RootLayout({ children }: any) {
  return (
    <html lang="en" className={`${inter.variable} ${ibmPlexMono.variable} ${dmSans.variable} dark`}>
      <head>
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
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
        {/* oxlint-disable-next-line nextjs/no-page-custom-font */}
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

"use client";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { cn } from "@/shared/utils/cn";
import Header from "../Header";
import Sidebar from "../Sidebar";

type AuthState = "loading" | "ok" | "redirect";

export default function DashboardLayout({ children }: { children?: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("loading");
  const pathname = usePathname();
  const router = useRouter();

  const isChat = pathname === "/basic-chat";

  useEffect(() => {
    let cancelled = false;
    const hasAuthCookie = document.cookie.split("; ").some((c) => c.startsWith("auth_token="));
    if (hasAuthCookie) {
      setAuthState("ok");
      return;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    fetch("/api/settings/require-login", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { requireLogin: true }))
      .then((data: { requireLogin?: boolean }) => {
        clearTimeout(timeoutId);
        if (cancelled) return;
        if (data.requireLogin === false) {
          setAuthState("ok");
        } else {
          setAuthState("redirect");
          router.replace("/login");
        }
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(timeoutId);
        setAuthState("redirect");
        router.replace("/login");
      });
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [router]);

  if (authState === "loading" || authState === "redirect") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-pitch-black">
        <div className="size-6 rounded-full border-2 border-storm-cloud/30 border-t-storm-cloud animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-pitch-black">
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast:
              "rounded-[6px] border border-charcoal-grey bg-graphite text-porcelain shadow-[var(--shadow-xl)] text-[12px]",
            title: "text-[12px] font-[510] text-porcelain",
            description: "text-[11px] text-storm-cloud",
            success: "border-emerald/30 bg-emerald/8 text-emerald",
            error: "border-warning-red/30 bg-warning-red/8 text-warning-red",
            warning: "border-yellow-500/30 bg-yellow-500/8 text-yellow-400",
            info: "border-aether-blue/30 bg-aether-blue/8 text-aether-blue",
            closeButton: "text-fog-grey hover:text-porcelain",
          },
        }}
      />

      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={cn(
          "hidden lg:flex transition-all duration-200",
          sidebarCollapsed ? "w-14" : "w-60",
        )}
      >
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
      </div>

      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 lg:hidden transition-transform duration-200 ease-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      <main className="flex flex-col flex-1 h-full min-w-0 overflow-hidden">
        <Header
          key={pathname}
          onMenuClick={() => setSidebarOpen(true)}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        />
        <div
          className={cn(
            "flex-1 overflow-y-auto custom-scrollbar",
            isChat ? "flex flex-col overflow-hidden" : "p-4 lg:p-6",
          )}
        >
          <div className={cn(isChat ? "flex-1 w-full h-full flex flex-col" : "max-w-7xl mx-auto")}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

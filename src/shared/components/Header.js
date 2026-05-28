"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import PropTypes from "prop-types";
import { useMemo } from "react";
import HeaderMenu from "@/shared/components/HeaderMenu";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { APIKEY_PROVIDERS, OAUTH_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useHeaderActionStore } from "@/store/headerActionStore";
import { useHeaderSearchStore } from "@/store/headerSearchStore";

const getPageInfo = (pathname) => {
  if (!pathname) return { title: "", description: "", breadcrumbs: [] };

  const mediaDetailMatch = pathname.match(/\/media-providers\/([^/]+)\/([^/]+)$/);
  if (mediaDetailMatch) {
    const kindId = mediaDetailMatch[1];
    const providerId = mediaDetailMatch[2];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    const provider = AI_PROVIDERS[providerId];
    return {
      title: provider?.name || providerId,
      description: "",
      breadcrumbs: [
        {
          label: kindConfig?.label || kindId,
          href: kindId === "webSearch" || kindId === "webFetch" ? "/media-providers/web" : `/media-providers/${kindId}`,
          icon: kindConfig?.icon || "perm_media",
        },
        { label: provider?.name || providerId, image: `/providers/${providerId}.png` },
      ],
    };
  }

  const mediaKindMatch = pathname.match(/\/media-providers\/([^/]+)$/);
  if (mediaKindMatch) {
    const kindId = mediaKindMatch[1];
    if (kindId === "web") {
      return {
        title: "Web Fetch & Search",
        description: "Manage your web fetch and search providers",
        icon: "travel_explore",
        breadcrumbs: [],
      };
    }
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    return {
      title: kindConfig?.label || kindId,
      description: `Manage your ${kindConfig?.label || kindId} providers`,
      icon: kindConfig?.icon || "perm_media",
      breadcrumbs: [],
    };
  }

  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    const providerInfo = OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || AI_PROVIDERS[providerId];
    if (providerInfo) {
      return {
        title: providerInfo.name,
        description: "",
        breadcrumbs: [
          { label: "LLM Providers", href: "/providers", icon: "dns" },
          { label: providerInfo.name, image: `/providers/${providerInfo.id || providerId}.png` },
        ],
      };
    }
    // Fallback for unknown provider IDs
    return {
      title: providerId,
      description: "",
      breadcrumbs: [{ label: "LLM Providers", href: "/providers", icon: "dns" }, { label: providerId }],
    };
  }

  if (pathname.includes("/providers/new"))
    return {
      title: "Add New Provider",
      description: "",
      breadcrumbs: [{ label: "LLM Providers", href: "/providers", icon: "dns" }, { label: "New" }],
    };
  if (pathname.includes("/providers") && !pathname.includes("/media-providers"))
    return { title: "LLM Providers", description: "Manage your AI provider connections", icon: "dns", breadcrumbs: [] };
  if (pathname.includes("/combos"))
    return { title: "Combos", description: "Model combos with fallback", icon: "layers", breadcrumbs: [] };
  if (pathname.includes("/usage"))
    return {
      title: "Usage",
      description: "Monitor API usage, token consumption, and request logs",
      icon: "bar_chart",
      breadcrumbs: [],
    };
  if (pathname.includes("/quota"))
    return {
      title: "Quota Tracker",
      description: "Track and manage your API quota limits",
      icon: "data_usage",
      breadcrumbs: [],
    };
  if (pathname.includes("/proxy-pools"))
    return { title: "Proxy Pools", description: "Manage your proxy pool configurations", icon: "lan", breadcrumbs: [] };
  if (pathname.includes("/endpoint") || pathname === "/endpoint")
    return { title: "Endpoint", description: "API endpoint configuration", icon: "api", breadcrumbs: [] };
  if (pathname.includes("/settings"))
    return { title: "Settings", description: "Manage your preferences", icon: "settings", breadcrumbs: [] };
  if (pathname.includes("/translator"))
    return {
      title: "Translator",
      description: "Debug translation flow between formats",
      icon: "translate",
      breadcrumbs: [],
    };
  if (pathname.includes("/logs"))
    return {
      title: "Logs",
      description: "Request logs, proxy pools, and console output",
      icon: "terminal",
      breadcrumbs: [],
    };
  if (pathname.includes("/memory"))
    return { title: "Memory", description: "Manage memory entries", icon: "memory_alt", breadcrumbs: [] };
  if (pathname.includes("/health"))
    return {
      title: "Health",
      description: "Live system status, database, providers, and cache",
      icon: "monitor_heart",
      breadcrumbs: [],
    };
  if (pathname.includes("/cache"))
    return { title: "Cache", description: "Semantic cache configuration", icon: "cached", breadcrumbs: [] };

  return { title: "", description: "", breadcrumbs: [] };
};

export default function Header({ onMenuClick, showMenuButton = true, sidebarCollapsed, onToggleSidebar }) {
  const pathname = usePathname();
  const router = useRouter();
  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const { title, icon, breadcrumbs } = pageInfo;

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        router.push("/login");
        router.refresh();
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  return (
    <header className="shrink-0 flex items-center justify-between gap-3 px-4 h-14 border-b border-charcoal-grey bg-pitch-black z-20">
      {/* Left: sidebar toggles */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Mobile only */}
        {showMenuButton && (
          <div className="lg:hidden">
            <button
              onClick={onMenuClick}
              className="flex items-center justify-center size-7 rounded-[4px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
            >
              <span className="material-symbols-outlined text-[18px]">menu</span>
            </button>
          </div>
        )}
      </div>

      {/* Center: breadcrumbs / title */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {breadcrumbs.length > 0 ? (
          breadcrumbs.map((crumb, index) => (
            <div key={`${crumb.label}-${crumb.href || "current"}`} className="flex items-center gap-1.5">
              {index > 0 && <span className="material-symbols-outlined text-fog-grey text-[14px]">chevron_right</span>}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="flex items-center gap-1 text-[13px] text-storm-cloud hover:text-porcelain transition-colors duration-100 tracking-[-0.12px]"
                >
                  {crumb.icon && <span className="material-symbols-outlined text-[15px]">{crumb.icon}</span>}
                  <span className="mt-0.5 ms-0.5">{crumb.label}</span>
                </Link>
              ) : (
                <div className="flex items-center gap-1.5">
                  {crumb.image && (
                    <div className="flex items-center justify-center size-[18px] rounded-[3px] bg-white shrink-0">
                      <ProviderIcon
                        src={crumb.image}
                        alt={crumb.label}
                        size={18}
                        className="rounded-[3px]"
                        fallbackText={crumb.label.slice(0, 2).toUpperCase()}
                      />
                    </div>
                  )}
                  <span className="text-[13px] font-[510] text-porcelain tracking-[-0.12px] truncate mt-0.5 ms-0.5">
                    {crumb.label}
                  </span>
                </div>
              )}
            </div>
          ))
        ) : title ? (
          <div className="flex items-center gap-1.5">
            {icon && <span className="material-symbols-outlined text-storm-cloud text-[16px]">{icon}</span>}
            <span className="text-[13px] font-[510] text-porcelain tracking-[-0.12px] truncate mt-0.5">{title}</span>
          </div>
        ) : null}
      </div>

      {/* Right: action + search + menu */}
      <div className="flex items-center gap-1 shrink-0">
        <HeaderAction />
        <HeaderSearch />
        <HeaderMenu onLogout={handleLogout} />
      </div>
    </header>
  );
}

function HeaderAction() {
  const action = useHeaderActionStore((s) => s.action);
  if (!action) return null;
  return (
    <button
      type="button"
      onClick={action.onClick}
      title={action.title || action.label}
      className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[4px] border text-[11px] font-[510] transition-colors duration-100 ${
        action.active
          ? "border-emerald/30 bg-emerald/8 text-emerald"
          : "border-charcoal-grey text-fog-grey hover:bg-deep-slate hover:text-porcelain"
      }`}
    >
      {action.icon && <span className="material-symbols-outlined text-[13px]">{action.icon}</span>}
      <span className="hidden sm:inline">{action.label}</span>
    </button>
  );
}

function HeaderSearch() {
  const visible = useHeaderSearchStore((s) => s.visible);
  const query = useHeaderSearchStore((s) => s.query);
  const placeholder = useHeaderSearchStore((s) => s.placeholder);
  const setQuery = useHeaderSearchStore((s) => s.setQuery);

  if (!visible) return null;

  return (
    <div className="relative w-[160px] sm:w-[200px]">
      <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-storm-cloud text-[14px] pointer-events-none">
        search
      </span>
      <input
        aria-label="Search"
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full h-7 pl-8 pr-6 rounded-[6px] border border-charcoal-grey bg-gunmetal text-[12px] text-porcelain placeholder:text-fog-grey focus:outline-none focus:border-porcelain/50 transition-colors duration-100"
        name="search"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-storm-cloud hover:text-porcelain transition-colors"
          aria-label="Clear search"
        >
          <span className="material-symbols-outlined text-[13px]">close</span>
        </button>
      )}
    </div>
  );
}

Header.propTypes = {
  onMenuClick: PropTypes.func,
  showMenuButton: PropTypes.bool,
};

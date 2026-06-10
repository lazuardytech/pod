"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import PropTypes from "prop-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { cn } from "@/shared/utils/cn";
import { ConfirmModal } from "./Modal";
import LucideIcon from "@/shared/components/LucideIcon";

function MediaFlyout({ isMediaActive, pathname, onClose }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0 });
  const triggerRef = useRef(null);
  const flyoutRef = useRef(null);
  const timerRef = useRef(null);

  const show = useCallback(() => {
    clearTimeout(timerRef.current);
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.top });
    }
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    timerRef.current = setTimeout(() => setOpen(false), 80);
  }, []);

  const cancelHide = useCallback(() => {
    clearTimeout(timerRef.current);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts", "stt"];
  const COMBINED_WEB_ITEM = {
    id: "web",
    label: "Web Fetch & Search",
    icon: "travel_explore",
    href: "/media-providers/web",
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className={cn(
          "flex items-center justify-center py-2 rounded-[2px] transition-colors duration-100",
          isMediaActive ? "bg-porcelain/8 text-porcelain" : "text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
        )}
      >
        <LucideIcon
          name="perm_media"
          size={SIDEBAR_ICON_SIZES.expanded}
          className={cn(isMediaActive ? "text-porcelain" : "text-fog-grey")}
        />
      </div>

      {open && (
        <div
          ref={flyoutRef}
          onMouseEnter={cancelHide}
          onMouseLeave={hide}
          style={{ top: pos.top, left: 56 }}
          className="fixed z-[200] rounded-[6px] border border-charcoal-grey bg-graphite shadow-[var(--shadow-xl)] py-1 min-w-[180px]"
        >
          <p className="px-3 py-1.5 text-[10px] font-[590] text-fog-grey uppercase tracking-[0.06em]">
            Media Providers
          </p>
          {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
            <Link
              key={kind.id}
              prefetch={false}
              href={`/media-providers/${kind.id}`}
              onClick={() => {
                setOpen(false);
                onClose?.();
              }}
              className={cn(
                "flex items-center gap-2.5 px-3 py-1.5 transition-colors duration-100",
                pathname.startsWith(`/media-providers/${kind.id}`)
                  ? "text-porcelain bg-porcelain/8"
                  : "text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
              )}
            >
              <LucideIcon name={kind.icon} size={SIDEBAR_ICON_SIZES.nested} />
              <span className="text-[13px] tracking-[-0.1px]">{kind.label}</span>
            </Link>
          ))}
          <Link
            prefetch={false}
            href={COMBINED_WEB_ITEM.href}
            onClick={() => {
              setOpen(false);
              onClose?.();
            }}
            className={cn(
              "flex items-center gap-2.5 px-3 py-1.5 transition-colors duration-100",
              pathname.startsWith(COMBINED_WEB_ITEM.href)
                ? "text-porcelain bg-porcelain/8"
                : "text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
            )}
          >
            <LucideIcon name={COMBINED_WEB_ITEM.icon} size={SIDEBAR_ICON_SIZES.nested} />
            <span className="text-[13px] tracking-[-0.1px]">{COMBINED_WEB_ITEM.label}</span>
          </Link>
        </div>
      )}
    </>
  );
}

const VISIBLE_MEDIA_KINDS = ["embedding", "image", "tts", "stt"];
const COMBINED_WEB_ITEM = {
  id: "web",
  label: "Web Fetch & Search",
  icon: "travel_explore",
  href: "/media-providers/web",
};

const SIDEBAR_ICON_SIZES = {
  collapsed: 18,
  expanded: 16,
  nested: 14,
  footerExpanded: 13,
};

const apiItems = [
  { href: "/endpoint", label: "Endpoint", icon: "api" },
  { href: "/providers", label: "LLM Providers", icon: "dns" },
  { href: "/combos", label: "Combos", icon: "layers" },
  { href: "/memory", label: "Memory", icon: "memory_alt" },
  { href: "/cache", label: "Cache", icon: "cached" },
];

const analyticsItems = [
  { href: "/usage", label: "Usage", icon: "chart-no-axes-combined" },
  { href: "/quota", label: "Quota", icon: "chart-pie" },
];

const systemItems = [
  { href: "/health", label: "Health", icon: "monitor_heart" },
  { href: "/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/logs", label: "Logs", icon: "terminal" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function NavSection({ label, children, collapsed }) {
  if (collapsed) return <div className="space-y-0.5">{children}</div>;
  return (
    <div className="pt-4 first:pt-0">
      <p className="px-3 mb-1 text-[10px] font-[590] text-fog-grey uppercase tracking-[0.06em]">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavItem({ href, label, icon, active, onClick, collapsed }) {
  return (
    <Link
      prefetch={false}
      href={href}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-[2px] transition-colors duration-100 group",
        collapsed ? "justify-center px-0 py-2" : "px-3 py-1.5",
        active ? "bg-porcelain/8 text-porcelain" : "text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
      )}
    >
      <LucideIcon
        name={icon}
        size={collapsed ? SIDEBAR_ICON_SIZES.collapsed : SIDEBAR_ICON_SIZES.expanded}
        className={cn("shrink-0", active ? "text-porcelain" : "text-fog-grey group-hover:text-storm-cloud")}
      />
      {!collapsed && <span className="text-[13px] font-[400] tracking-[-0.12px] truncate">{label}</span>}
    </Link>
  );
}

export default function Sidebar({ onClose, collapsed = false, onToggleCollapse }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [showShutdownModal, setShowShutdownModal] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const collapsedFooterButtonClass = "size-8 rounded-[6px] text-fog-grey hover:bg-deep-slate hover:text-porcelain";

  const isActive = (href) => {
    if (href === "/endpoint") {
      return pathname === "/" || pathname.startsWith("/endpoint");
    }
    return pathname.startsWith(href);
  };

  const isMediaActive = pathname.startsWith("/media-providers");

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/shutdown", { method: "POST" });
    } catch {}
    setIsShuttingDown(false);
    setShowShutdownModal(false);
    setIsDisconnected(true);
  };

  const handleRestart = async () => {
    setIsRestarting(true);
    try {
      await fetch("/api/restart", { method: "POST" });
    } catch {}
    setTimeout(() => globalThis.location.reload(), 3000);
  };

  return (
    <>
      <aside
        className={cn(
          "flex flex-col border-r border-charcoal-grey bg-graphite min-h-full overflow-hidden transition-all duration-200",
          collapsed ? "w-14" : "w-60",
        )}
      >
        {/* App title + collapse button */}
        <div className="flex items-center h-14 px-3 border-b border-charcoal-grey shrink-0 gap-2">
          {!collapsed && (
            <Link
              prefetch={false}
              href="/endpoint"
              className="flex items-center gap-2.5 flex-1 min-w-0 group px-2 py-4"
              onClick={onClose}
            >
              <div className="flex items-center justify-center size-7 shrink-0">
                <img src="/logo.svg" alt="Pod" className="size-7 dark:invert" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-brand text-xl font-[590] text-porcelain tracking-[-0.2px] leading-none truncate">
                  {APP_CONFIG.name}
                </span>
              </div>
            </Link>
          )}

          {collapsed && (
            <Link
              prefetch={false}
              href="/endpoint"
              onClick={onClose}
              title={APP_CONFIG.name}
              className="flex items-center justify-center size-7 mx-auto"
            >
              <img src="/logo.svg" alt="Pod" className="size-7 dark:invert" />
            </Link>
          )}

          {/* Collapse toggle — desktop only, expanded mode only */}
          {onToggleCollapse && !collapsed && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title="Collapse sidebar"
              className="hidden lg:flex items-center justify-center size-6 rounded-[4px] text-fog-grey hover:bg-deep-slate hover:text-porcelain transition-colors duration-100 shrink-0"
            >
              <LucideIcon name="left_panel_close" className="text-[15px]" />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className={cn("flex-1 overflow-y-auto custom-scrollbar space-y-0", collapsed ? "px-1 py-3" : "px-2 py-3")}>
          <NavSection label="API" collapsed={collapsed}>
            <NavItem {...apiItems[0]} active={isActive(apiItems[0].href)} onClick={onClose} collapsed={collapsed} />
            <NavItem {...apiItems[1]} active={isActive(apiItems[1].href)} onClick={onClose} collapsed={collapsed} />

            {/* Media Providers — flyout on hover when collapsed, accordion when expanded */}
            {collapsed ? (
              <MediaFlyout isMediaActive={isMediaActive} pathname={pathname} onClose={onClose} />
            ) : (
              <>
                <button
                  onClick={() => setMediaOpen((v) => !v)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-1.5 rounded-[2px] transition-colors duration-100 group",
                    isMediaActive
                      ? "bg-porcelain/8 text-porcelain"
                      : "text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
                  )}
                >
                  <LucideIcon
                    name="perm_media"
                    size={SIDEBAR_ICON_SIZES.expanded}
                    className={cn(
                      "shrink-0",
                      isMediaActive ? "text-porcelain" : "text-fog-grey group-hover:text-storm-cloud",
                    )}
                  />
                  <span className="text-[13px] font-[400] tracking-[-0.12px] flex-1 text-left truncate">
                    Media Providers
                  </span>
                  <LucideIcon
                    name="expand_more"
                    size={SIDEBAR_ICON_SIZES.expanded}
                    className="text-fog-grey transition-transform duration-150"
                    style={{ transform: mediaOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </button>

                {mediaOpen && (
                  <div className="pl-3 space-y-0.5">
                    {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
                      <Link
                        key={kind.id}
                        prefetch={false}
                        href={`/media-providers/${kind.id}`}
                        onClick={onClose}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 rounded-[2px] transition-colors duration-100",
                          pathname.startsWith(`/media-providers/${kind.id}`)
                            ? "text-porcelain"
                            : "text-fog-grey hover:bg-deep-slate hover:text-storm-cloud",
                        )}
                      >
                        <LucideIcon name={kind.icon} size={SIDEBAR_ICON_SIZES.nested} />
                        <span className="text-[13px] tracking-[-0.1px]">{kind.label}</span>
                      </Link>
                    ))}
                    <Link
                      prefetch={false}
                      href={COMBINED_WEB_ITEM.href}
                      onClick={onClose}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-[2px] transition-colors duration-100",
                        pathname.startsWith(COMBINED_WEB_ITEM.href)
                          ? "text-porcelain"
                          : "text-fog-grey hover:bg-deep-slate hover:text-storm-cloud",
                      )}
                    >
                      <LucideIcon name={COMBINED_WEB_ITEM.icon} size={SIDEBAR_ICON_SIZES.nested} />
                      <span className="text-[13px] tracking-[-0.1px]">{COMBINED_WEB_ITEM.label}</span>
                    </Link>
                  </div>
                )}
              </>
            )}

            {apiItems.slice(2).map((item) => (
              <NavItem key={item.href} {...item} active={isActive(item.href)} onClick={onClose} collapsed={collapsed} />
            ))}
          </NavSection>

          {!collapsed && <div className="h-px" />}

          <NavSection label="Analytics" collapsed={collapsed}>
            {analyticsItems.map((item) => (
              <NavItem key={item.href} {...item} active={isActive(item.href)} onClick={onClose} collapsed={collapsed} />
            ))}
          </NavSection>

          {!collapsed && <div className="h-px" />}

          <NavSection label="System" collapsed={collapsed}>
            {systemItems.map((item) => (
              <NavItem key={item.href} {...item} active={isActive(item.href)} onClick={onClose} collapsed={collapsed} />
            ))}
          </NavSection>
        </nav>

        {/* Footer actions */}
        <div className={cn("flex flex-col border-t border-charcoal-grey", collapsed ? "p-1.5 gap-1" : "p-2 gap-1.5")}>
          {/* Version label — expanded only */}
          {!collapsed && (
            <p className="text-[11px] text-fog-grey px-1 pb-0.5">
              {APP_CONFIG.name} v{APP_CONFIG.displayVersion}
            </p>
          )}
          <div className={cn("flex items-center", collapsed ? "flex-col gap-1" : "gap-1.5")}>
            {collapsed && onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                title="Expand sidebar"
                className={cn(
                  "hidden lg:flex items-center justify-center transition-colors duration-100",
                  collapsedFooterButtonClass,
                )}
              >
                <LucideIcon name="left_panel_open" size={SIDEBAR_ICON_SIZES.collapsed} />
              </button>
            )}
            <button
              onClick={handleRestart}
              disabled={isRestarting}
              title="Restart"
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-[6px] disabled:opacity-40 transition-colors duration-100 text-[12px]",
                collapsed
                  ? collapsedFooterButtonClass
                  : "flex-1 h-7 border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain",
              )}
            >
              {isRestarting ? (
                <LucideIcon
                  name="progress_activity"
                  size={collapsed ? SIDEBAR_ICON_SIZES.collapsed : SIDEBAR_ICON_SIZES.footerExpanded}
                  className="animate-spin"
                />
              ) : (
                <LucideIcon
                  name="restart_alt"
                  size={collapsed ? SIDEBAR_ICON_SIZES.collapsed : SIDEBAR_ICON_SIZES.footerExpanded}
                />
              )}
              {!collapsed && "Restart"}
            </button>
            <button
              onClick={() => setShowShutdownModal(true)}
              title="Shutdown"
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-[6px] transition-colors duration-100 text-[12px]",
                collapsed
                  ? collapsedFooterButtonClass
                  : "flex-1 h-7 border border-charcoal-grey text-storm-cloud hover:bg-warning-red/10 hover:border-warning-red/30 hover:text-warning-red",
              )}
            >
              <LucideIcon
                name="power_settings_new"
                size={collapsed ? SIDEBAR_ICON_SIZES.collapsed : SIDEBAR_ICON_SIZES.footerExpanded}
              />
              {!collapsed && "Shutdown"}
            </button>
          </div>
        </div>
      </aside>

      <ConfirmModal
        isOpen={showShutdownModal}
        onClose={() => setShowShutdownModal(false)}
        onConfirm={handleShutdown}
        title="Shutdown Server"
        message="Are you sure you want to stop the proxy server?"
        confirmText="Shutdown"
        cancelText="Cancel"
        variant="danger"
        loading={isShuttingDown}
      />

      {isDisconnected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-pitch-black/90 backdrop-blur-sm p-6">
          <div className="text-center p-8">
            <div className="flex items-center justify-center size-12 rounded-full bg-warning-red/10 text-warning-red mx-auto mb-4">
              <LucideIcon name="power_off" className="text-[24px]" />
            </div>
            <h2 className="text-[15px] font-[510] text-porcelain mb-1.5 tracking-[-0.13px]">Server Disconnected</h2>
            <p className="text-[12px] text-storm-cloud mb-5">The proxy server has been stopped.</p>
            <button
              onClick={() => globalThis.location.reload()}
              className="h-8 px-4 rounded-[6px] bg-gunmetal border border-charcoal-grey text-[12px] text-porcelain hover:bg-deep-slate transition-colors duration-100"
            >
              Reload Page
            </button>
          </div>
        </div>
      )}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  collapsed: PropTypes.bool,
  onToggleCollapse: PropTypes.func,
};

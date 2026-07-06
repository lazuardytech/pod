"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import LucideIcon from "@/shared/components/LucideIcon";

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  return (
    <nav className="fixed top-0 z-50 w-full bg-pitch-black/90 backdrop-blur-md border-b border-charcoal-grey">
      <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
        {/* Logo */}
        <button
          type="button"
          className="flex items-center gap-2.5 cursor-pointer bg-transparent border-none p-0"
          onClick={() => router.push("/")}
          aria-label="Navigate to home"
        >
          <div className="size-7 rounded-[6px] bg-porcelain flex items-center justify-center">
            <LucideIcon name="hub" className="text-pitch-black text-[16px]" />
          </div>
          <span className="text-porcelain text-[14px] font-[510] tracking-[-0.13px]">Pod</span>
        </button>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {[
            { label: "Features", href: "#features" },
            { label: "How it Works", href: "#how-it-works" },
            { label: "Docs", href: "https://github.com/lazuardytech/pod#readme", external: true },
            { label: "GitHub", href: "https://github.com/lazuardytech/pod", external: true },
          ].map((item) => (
            <a
              key={item.label}
              href={item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener noreferrer" : undefined}
              className="text-[13px] text-storm-cloud hover:text-porcelain transition-colors duration-100 tracking-[-0.12px]"
            >
              {item.label}
            </a>
          ))}
        </div>

        {/* CTA + mobile toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/dashboard")}
            className="hidden sm:flex h-7 items-center justify-center rounded-[6px] px-3 bg-[#E5E5E6] hover:bg-white text-pitch-black text-[12px] font-[590] transition-colors duration-100"
          >
            Open Dashboard
          </button>
          <button
            className="md:hidden flex items-center justify-center size-7 rounded-[4px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <LucideIcon name={mobileMenuOpen ? "close" : "menu"} className="text-[18px]" />
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-charcoal-grey bg-graphite">
          <div className="flex flex-col py-2">
            {[
              { label: "Features", href: "#features" },
              { label: "How it Works", href: "#how-it-works" },
              { label: "Docs", href: "https://github.com/lazuardytech/pod#readme", external: true },
              { label: "GitHub", href: "https://github.com/lazuardytech/pod", external: true },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className="px-6 py-2.5 text-[13px] text-storm-cloud hover:text-porcelain hover:bg-deep-slate transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <div className="px-6 pt-2 pb-3">
              <button
                onClick={() => router.push("/dashboard")}
                className="w-full h-8 rounded-[6px] bg-porcelain text-pitch-black text-[13px] font-[590] transition-colors hover:bg-white"
              >
                Open Dashboard
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}

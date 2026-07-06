"use client";
import LucideIcon from "@/shared/components/LucideIcon";

export default function Footer() {
  return (
    <footer className="border-t border-charcoal-grey bg-graphite pt-12 pb-6 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-10">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="size-7 rounded-[6px] bg-porcelain flex items-center justify-center">
                <LucideIcon name="hub" className="text-pitch-black text-[16px]" />
              </div>
              <span className="text-[14px] font-[510] text-porcelain tracking-[-0.13px]">Pod</span>
            </div>
            <p className="text-[12px] text-fog-grey max-w-xs leading-[1.6] mb-5 tracking-[-0.1px]">
              The unified endpoint for AI generation. Connect, route, and manage your AI providers
              with ease.
            </p>
            <a
              href="https://github.com/lazuardytech/pod"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center size-7 rounded-[4px] border border-charcoal-grey text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
            >
              <LucideIcon name="code" className="text-[15px]" />
            </a>
          </div>

          {/* Product */}
          <div className="flex flex-col gap-3">
            <h4 className="text-[11px] font-[590] text-fog-grey uppercase tracking-[0.06em]">
              Product
            </h4>
            {[
              { label: "Features", href: "#features" },
              { label: "Dashboard", href: "/dashboard" },
              { label: "Changelog", href: "https://github.com/lazuardytech/pod", external: true },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                target={item.external ? "_blank" : undefined}
                rel={item.external ? "noopener noreferrer" : undefined}
                className="text-[12px] text-storm-cloud hover:text-porcelain transition-colors duration-100 tracking-[-0.1px]"
              >
                {item.label}
              </a>
            ))}
          </div>

          {/* Resources */}
          <div className="flex flex-col gap-3">
            <h4 className="text-[11px] font-[590] text-fog-grey uppercase tracking-[0.06em]">
              Resources
            </h4>
            {[
              {
                label: "Documentation",
                href: "https://github.com/lazuardytech/pod#readme",
                external: true,
              },
              { label: "GitHub", href: "https://github.com/lazuardytech/pod", external: true },
              { label: "NPM", href: "https://www.npmjs.com/package/pod", external: true },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-storm-cloud hover:text-porcelain transition-colors duration-100 tracking-[-0.1px]"
              >
                {item.label}
              </a>
            ))}
          </div>

          {/* Legal */}
          <div className="flex flex-col gap-3">
            <h4 className="text-[11px] font-[590] text-fog-grey uppercase tracking-[0.06em]">
              Legal
            </h4>
            <a
              href="https://github.com/lazuardytech/pod/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-storm-cloud hover:text-porcelain transition-colors duration-100 tracking-[-0.1px]"
            >
              MIT License
            </a>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-charcoal-grey pt-5 flex flex-col md:flex-row justify-between items-center gap-3">
          <p className="text-[11px] text-fog-grey tracking-[-0.1px]">
            © 2025 Pod. All rights reserved.
          </p>
          <div className="flex gap-5">
            {[
              { label: "GitHub", href: "https://github.com/lazuardytech/pod" },
              { label: "NPM", href: "https://www.npmjs.com/package/pod" },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-fog-grey hover:text-storm-cloud transition-colors duration-100 tracking-[-0.1px]"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

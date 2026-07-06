"use client";
import Link from "next/link";
import LucideIcon from "@/shared/components/LucideIcon";

export default function HeroSection() {
  return (
    <section className="relative pt-28 pb-20 px-6 min-h-[90vh] flex flex-col items-center justify-center overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-porcelain/4 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-aether-blue/4 rounded-full blur-[100px] pointer-events-none" />

      {/* Grid overlay */}
      <div className="landing-grid absolute inset-0 pointer-events-none" aria-hidden="true" />

      <div className="relative z-10 max-w-3xl w-full text-center flex flex-col items-center gap-6">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-charcoal-grey bg-graphite px-3 py-1">
          <span className="size-1.5 rounded-full bg-porcelain animate-pulse" />
          <span className="text-[11px] text-storm-cloud tracking-[-0.1px]">v1.0 is now live</span>
        </div>

        {/* Heading */}
        <h1 className="text-[48px] md:text-[64px] font-[590] leading-[1.1] tracking-[-0.22px] text-porcelain">
          One Endpoint for <br />
          <span className="text-porcelain">All AI Providers</span>
        </h1>

        {/* Description */}
        <p className="text-[15px] text-storm-cloud max-w-xl leading-[1.6] tracking-[-0.13px]">
          AI endpoint proxy with web dashboard. Works seamlessly with Claude Code, OpenAI Codex,
          Cline, RooCode, and other CLI tools.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 h-9 px-5 rounded-[6px] bg-[#E5E5E6] hover:bg-white text-pitch-black text-[13px] font-[590] transition-colors duration-100 shadow-[var(--shadow-sm)]"
          >
            <LucideIcon name="rocket_launch" className="text-[16px]" />
            Get Started
          </Link>
          <a
            href="https://github.com/lazuardytech/pod"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-9 px-5 rounded-[6px] border border-charcoal-grey bg-graphite hover:bg-deep-slate text-porcelain text-[13px] font-[400] transition-colors duration-100"
          >
            <LucideIcon name="code" className="text-[16px]" />
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

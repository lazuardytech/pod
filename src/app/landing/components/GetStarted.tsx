"use client";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const STEPS = [
  {
    number: "1",
    title: "Install Pod",
    desc: "Run bunx to start the server instantly",
  },
  {
    number: "2",
    title: "Open Dashboard",
    desc: "Configure providers and API keys via web interface",
  },
  {
    number: "3",
    title: "Route Requests",
    desc: "Point your CLI tools to http://localhost:20128",
  },
];

export default function GetStarted() {
  const { copied, copy } = useCopyToClipboard();

  return (
    <section className="py-20 px-6 bg-pitch-black">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-12 items-start">
          {/* Left: Steps */}
          <div className="flex-1">
            <h2 className="text-[32px] font-[590] text-porcelain tracking-[-0.22px] mb-3">Get Started in 30 Seconds</h2>
            <p className="text-[14px] text-storm-cloud leading-[1.6] tracking-[-0.13px] mb-8">
              Install Pod, configure your providers via web dashboard, and start routing AI requests.
            </p>

            <div className="flex flex-col gap-5">
              {STEPS.map((step) => (
                <div key={step.number} className="flex gap-3">
                  <div className="flex-none flex items-center justify-center size-6 rounded-[4px] bg-porcelain/8 text-porcelain text-[11px] font-[590] mt-0.5">
                    {step.number}
                  </div>
                  <div>
                    <h4 className="text-[13px] font-[510] text-porcelain tracking-[-0.12px]">{step.title}</h4>
                    <p className="text-[12px] text-fog-grey mt-0.5 tracking-[-0.1px]">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Terminal */}
          <div className="flex-1 w-full">
            <div className="rounded-[6px] overflow-hidden bg-graphite border border-charcoal-grey shadow-[var(--shadow-xl)]">
              {/* Terminal header */}
              <div className="flex items-center gap-1.5 px-4 py-2.5 bg-deep-slate border-b border-charcoal-grey">
                <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
                <span className="ml-2 text-[11px] text-fog-grey font-mono">terminal</span>
              </div>

              {/* Terminal body */}
              <div className="p-5 font-mono text-[12px] leading-relaxed overflow-x-auto">
                <div
                  className="flex items-center gap-2 mb-4 group cursor-pointer"
                  onClick={() => copy("bunx pod", "landing")}
                >
                  <span className="text-porcelain">$</span>
                  <span className="text-porcelain">bunx pod</span>
                  <span className="ml-auto text-[10px] text-fog-grey opacity-0 group-hover:opacity-100 transition-opacity">
                    {copied === "landing" ? "✓ copied" : "copy"}
                  </span>
                </div>

                <div className="space-y-1 text-storm-cloud mb-5">
                  <div>
                    <span className="text-porcelain/40">&gt;</span> Starting Pod...
                  </div>
                  <div>
                    <span className="text-porcelain/40">&gt;</span> Server running on{" "}
                    <span className="text-aether-blue">http://localhost:20128</span>
                  </div>
                  <div>
                    <span className="text-porcelain/40">&gt;</span> Dashboard:{" "}
                    <span className="text-aether-blue">http://localhost:20128/dashboard</span>
                  </div>
                  <div>
                    <span className="text-porcelain">&gt;</span>{" "}
                    <span className="text-porcelain">Ready to route! ✓</span>
                  </div>
                </div>

                <div className="border-t border-charcoal-grey pt-4 space-y-1 text-[11px] text-fog-grey">
                  <div className="text-storm-cloud">Data Location:</div>
                  <div>
                    <span className="text-fog-grey"> macOS/Linux:</span>{" "}
                    <span className="text-alabaster">~/.pod/db.json</span>
                  </div>
                  <div>
                    <span className="text-fog-grey"> Windows:</span>{" "}
                    <span className="text-alabaster">%APPDATA%/pod/db.json</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

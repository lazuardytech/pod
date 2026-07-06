"use client";
import LucideIcon from "@/shared/components/LucideIcon";

const STEPS = [
  {
    number: "01",
    title: "CLI & SDKs",
    desc: "Your requests start from your favorite tools or SDK. Just change the base URL.",
    icon: "terminal",
  },
  {
    number: "02",
    title: "Pod Hub",
    desc: "Our engine analyzes the prompt, checks provider health, and routes for lowest latency or cost.",
    icon: "hub",
    accent: true,
  },
  {
    number: "03",
    title: "AI Providers",
    desc: "The request is fulfilled by OpenAI, Anthropic, Gemini, or others instantly.",
    icon: "auto_awesome",
  },
];

export default function HowItWorks() {
  return (
    <section className="py-20 px-6 border-y border-charcoal-grey bg-graphite" id="how-it-works">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <h2 className="text-[32px] font-[590] text-porcelain tracking-[-0.22px] mb-3">
            How Pod Works
          </h2>
          <p className="text-[14px] text-storm-cloud max-w-md leading-[1.6] tracking-[-0.13px]">
            Data flows seamlessly from your application through our intelligent routing layer to the
            best provider.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-8 left-[20%] right-[20%] h-px bg-charcoal-grey z-0" />

          {STEPS.map((step) => (
            <div
              key={step.number}
              className={`relative z-10 p-5 rounded-[6px] border transition-colors duration-150 ${
                step.accent
                  ? "bg-deep-slate border-porcelain/10"
                  : "bg-pitch-black border-charcoal-grey hover:border-muted-ash"
              }`}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className={`flex items-center justify-center size-9 rounded-[6px] ${
                    step.accent ? "bg-porcelain" : "bg-deep-slate border border-charcoal-grey"
                  }`}
                >
                  <LucideIcon
                    name={step.icon}
                    className={`text-[18px] ${step.accent ? "text-pitch-black" : "text-storm-cloud"}`}
                  />
                </div>
                <span className="text-[11px] font-[590] text-fog-grey tracking-[0.04em]">
                  {step.number}
                </span>
              </div>
              <h3
                className={`text-[14px] font-[510] tracking-[-0.13px] mb-2 ${
                  step.accent ? "text-porcelain" : "text-porcelain"
                }`}
              >
                {step.title}
              </h3>
              <p className="text-[12px] text-fog-grey leading-[1.6] tracking-[-0.1px]">
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

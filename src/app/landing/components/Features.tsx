"use client";
import LucideIcon from "@/shared/components/LucideIcon";

const FEATURES = [
  { icon: "link", title: "Unified Endpoint", desc: "Access all providers via a single standard API URL." },
  { icon: "bolt", title: "Easy Setup", desc: "Get up and running in minutes with a single command." },
  {
    icon: "shield_with_heart",
    title: "Model Fallback",
    desc: "Automatically switch providers on failure or high latency.",
  },
  { icon: "monitoring", title: "Usage Tracking", desc: "Detailed analytics and cost monitoring across all models." },
  { icon: "key", title: "OAuth & API Keys", desc: "Securely manage credentials in one vault." },
  { icon: "cloud_sync", title: "Cloud Sync", desc: "Sync your configurations across devices instantly." },
  { icon: "terminal", title: "CLI Support", desc: "Works with Claude Code, Codex, Cline, Cursor, and more." },
  { icon: "dashboard", title: "Dashboard", desc: "Visual dashboard for real-time traffic analysis." },
];

export default function Features() {
  return (
    <section className="py-20 px-6" id="features">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <h2 className="text-[32px] font-[590] text-porcelain tracking-[-0.22px] mb-3">Powerful Features</h2>
          <p className="text-[14px] text-storm-cloud max-w-md leading-[1.6] tracking-[-0.13px]">
            Everything you need to manage your AI infrastructure in one place, built for scale.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="p-4 rounded-[6px] bg-graphite border border-charcoal-grey hover:border-muted-ash hover:bg-deep-slate transition-colors duration-150 group"
            >
              <div className="flex items-center justify-center size-8 rounded-[6px] bg-deep-slate text-storm-cloud mb-3 group-hover:text-porcelain transition-colors duration-150">
                <LucideIcon name={feature.icon} className="text-[17px]" />
              </div>
              <h3 className="text-[13px] font-[510] text-porcelain tracking-[-0.12px] mb-1.5">{feature.title}</h3>
              <p className="text-[12px] text-fog-grey leading-[1.6] tracking-[-0.1px]">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

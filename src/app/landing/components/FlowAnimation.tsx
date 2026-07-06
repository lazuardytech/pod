"use client";
import { useEffect, useState } from "react";
import LucideIcon from "@/shared/components/LucideIcon";

const PROVIDERS = [
  {
    id: "openai",
    name: "OpenAI",
    color: "bg-emerald-500",
    textColor: "text-white",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    color: "bg-orange-400",
    textColor: "text-white",
  },
  {
    id: "gemini",
    name: "Gemini",
    color: "bg-blue-500",
    textColor: "text-white",
  },
  {
    id: "github",
    name: "GitHub Copilot",
    color: "bg-gray-700",
    textColor: "text-white",
  },
];

export default function FlowAnimation() {
  const [activeFlow, setActiveFlow] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFlow((prev) => (prev + 1) % PROVIDERS.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mt-16 w-full max-w-4xl relative h-[360px] hidden md:flex items-center justify-center animate-[float_6s_ease-in-out_infinite]">
      {/* Pod Hub - Center */}
      <div className="relative z-20 w-32 h-32 rounded-full bg-[#23180f] border-2 border-[#f97815] shadow-[0_0_40px_rgba(249,120,21,0.3)] flex flex-col items-center justify-center gap-1 group cursor-pointer hover:scale-105 transition-transform duration-500">
        <LucideIcon name="hub" className="text-4xl text-[#f97815]" />
        <span className="text-xs font-bold text-white tracking-widest uppercase">Pod</span>
        <div className="absolute inset-0 rounded-full border border-[#f97815]/30 animate-ping opacity-20"></div>
      </div>

      {/* SVG Lines from Pod to Providers */}
      <svg
        className="absolute inset-0 w-full h-full z-10 pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M 440 180 C 550 180, 550 50, 740 50"
          fill="none"
          stroke={activeFlow === 0 ? "#f97815" : "rgb(75, 85, 99)"}
          strokeWidth={activeFlow === 0 ? "3" : "2"}
          className={activeFlow === 0 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 440 180 C 550 180, 550 130, 740 130"
          fill="none"
          stroke={activeFlow === 1 ? "#f97815" : "rgb(75, 85, 99)"}
          strokeWidth={activeFlow === 1 ? "3" : "2"}
          className={activeFlow === 1 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 440 180 C 550 180, 550 230, 740 230"
          fill="none"
          stroke={activeFlow === 2 ? "#f97815" : "rgb(75, 85, 99)"}
          strokeWidth={activeFlow === 2 ? "3" : "2"}
          className={activeFlow === 2 ? "animate-pulse" : ""}
        ></path>
        <path
          d="M 440 180 C 550 180, 550 310, 740 310"
          fill="none"
          stroke={activeFlow === 3 ? "#f97815" : "rgb(75, 85, 99)"}
          strokeWidth={activeFlow === 3 ? "3" : "2"}
          className={activeFlow === 3 ? "animate-pulse" : ""}
        ></path>
      </svg>

      {/* AI Providers - Right side */}
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-between py-6">
        {PROVIDERS.map((provider, idx) => (
          <div
            key={provider.id}
            className={`px-4 py-2 rounded-lg ${provider.color} ${provider.textColor} flex items-center justify-center font-bold text-xs shadow-lg hover:scale-110 transition-all cursor-help min-w-[140px] ${
              activeFlow === idx ? "ring-4 ring-[#f97815]/50 scale-110" : ""
            }`}
            title={provider.name}
          >
            {provider.name}
          </div>
        ))}
      </div>

      {/* Mobile fallback */}
      <div className="md:hidden mt-8 w-full p-4 rounded-lg bg-[#23180f] border border-[#3a2f27]">
        <p className="text-sm text-center text-gray-400">Interactive diagram visible on desktop</p>
      </div>
    </div>
  );
}

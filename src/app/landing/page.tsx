"use client";
import { useRouter } from "next/navigation";
import LucideIcon from "@/shared/components/LucideIcon";
import Features from "./components/Features";
import Footer from "./components/Footer";
import GetStarted from "./components/GetStarted";
import HeroSection from "./components/HeroSection";
import HowItWorks from "./components/HowItWorks";
import Navigation from "./components/Navigation";

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="relative text-porcelain font-sans overflow-x-hidden bg-pitch-black">
      {/* Subtle background glows */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-porcelain/3 rounded-full blur-[130px]" />
        <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-aether-blue/3 rounded-full blur-[130px]" />
      </div>

      <div className="relative z-10">
        <Navigation />

        <main>
          <HeroSection />
          <GetStarted />
          <HowItWorks />
          <Features />

          {/* CTA Section */}
          <section className="py-20 px-6 relative overflow-hidden border-t border-charcoal-grey">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="text-[32px] md:text-[48px] font-[590] text-porcelain tracking-[-0.22px] mb-4">
                Ready to Simplify Your AI Infrastructure?
              </h2>
              <p className="text-[14px] text-storm-cloud leading-[1.6] tracking-[-0.13px] mb-8 max-w-xl mx-auto">
                Join developers who are streamlining their AI integrations with Pod. Open source and free to start.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => router.push("/dashboard")}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-9 px-6 rounded-[6px] bg-[#E5E5E6] hover:bg-white text-pitch-black text-[13px] font-[590] transition-colors duration-100 shadow-[var(--shadow-sm)]"
                >
                  <LucideIcon name="rocket_launch" className="text-[16px]" />
                  Start Free
                </button>
                <button
                  onClick={() => window.open("https://github.com/lazuardytech/pod#readme", "_blank")}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-9 px-6 rounded-[6px] border border-charcoal-grey bg-graphite hover:bg-deep-slate text-porcelain text-[13px] font-[400] transition-colors duration-100"
                >
                  Read Documentation
                </button>
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </div>
  );
}

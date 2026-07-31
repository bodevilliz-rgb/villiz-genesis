import type { Metadata } from "next";
import {
  PublicHeader,
  HeroSection,
  SelectedWork,
  ServicesSection,
  BrandPhilosophy,
  ProcessSection,
  WhyVilliz,
  TrustSection,
  ClientStories,
  FinalCTA,
  PublicFooter,
} from "@/components/landing/landing-v2";

export const metadata: Metadata = {
  title: "Villiz Pixels · Creative Production & Marketing Studio",
  description: "A premium creative production and marketing studio combining media, strategy, AI integration, and workflow automation.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col selection:bg-primary/20 selection:text-primary">
      <PublicHeader />
      <main className="flex-1">
        <HeroSection />
        <SelectedWork />
        <ServicesSection />
        <BrandPhilosophy />
        <ProcessSection />
        <WhyVilliz />
        <TrustSection />
        <ClientStories />
        <FinalCTA />
      </main>
      <PublicFooter />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Camera, Cpu, Globe, MessageSquare } from "lucide-react";

export const metadata: Metadata = {
  title: "Villiz Pixels · Creative Production & Marketing Studio",
  description: "A premium creative production and marketing studio combining media, strategy, AI integration, and workflow automation.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#080808] text-white flex flex-col selection:bg-primary/20 selection:text-primary">
      {/* 1. Header */}
      <header className="sticky top-0 z-50 bg-[#080808]/90 backdrop-blur border-b border-border py-4 px-6 md:px-12 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2.5">
          <span aria-hidden className="size-3 rounded-full bg-primary" />
          <span className="font-mono text-sm font-bold uppercase tracking-[0.2em]">Villiz Pixels</span>
        </Link>
        <nav className="hidden md:flex items-center gap-8 text-[13px] text-muted-foreground font-medium">
          <a href="#services" className="hover:text-white transition-colors">Services</a>
          <a href="#about" className="hover:text-white transition-colors">About</a>
          <a href="#work" className="hover:text-white transition-colors">How We Work</a>
          <a href="#contact" className="hover:text-white transition-colors">Contact</a>
        </nav>
        <Link 
          href="/login"
          className="border border-border hover:bg-muted hover:text-white text-muted-foreground text-[12px] font-semibold px-4 py-1.5 rounded-md transition-colors"
        >
          Staff Portal
        </Link>
      </header>

      <main className="flex-1">
        {/* 2. Hero Section */}
        <section className="relative px-6 py-20 md:py-32 md:px-12 max-w-5xl mx-auto flex flex-col items-center text-center gap-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary font-bold">Creative Production & Marketing</span>
          <h1 className="font-sans font-extrabold text-4xl sm:text-6xl tracking-tight leading-[1.1] max-w-3xl">
            Where Every Frame <span className="text-primary">Tells a Story</span>.
          </h1>
          <p className="text-[15px] sm:text-lg text-muted-foreground max-w-2xl leading-relaxed">
            We are a creative production and marketing studio combining media, strategy, AI integration, and workflow automation to scale stories.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 mt-4 w-full sm:w-auto justify-center">
            <a 
              href="#services" 
              className="bg-primary hover:bg-primary-hover text-white text-[13px] font-bold px-6 py-3 rounded-md transition-colors flex items-center justify-center gap-2"
            >
              Explore Our Work <ArrowRight className="size-4" />
            </a>
            <a 
              href="#contact" 
              className="bg-card hover:bg-card-hover border border-border text-white text-[13px] font-bold px-6 py-3 rounded-md transition-colors text-center"
            >
              Contact Villiz
            </a>
          </div>
        </section>

        {/* 3. Services Section */}
        <section id="services" className="bg-[#131313] border-y border-border py-20 px-6 md:px-12">
          <div className="max-w-5xl mx-auto flex flex-col gap-12">
            <div className="flex flex-col gap-2 max-w-xl">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary font-bold">Capabilities</span>
              <h2 className="font-sans font-extrabold text-3xl tracking-tight">Our Core Services</h2>
              <p className="text-[13px] text-muted-foreground">Tailored strategies and assets engineered to deliver creative breakthroughs.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="border border-border bg-[#080808] p-6 rounded-lg flex flex-col gap-3">
                <Camera className="size-6 text-primary" />
                <h3 className="font-sans font-bold text-lg">Media</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  High-end photography, creative production, and brand storytelling. We direct every frame with premium artistic vision.
                </p>
              </div>
              <div className="border border-border bg-[#080808] p-6 rounded-lg flex flex-col gap-3">
                <Globe className="size-6 text-primary" />
                <h3 className="font-sans font-bold text-lg">Marketing</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  Data-guided digital campaigns, dynamic social media content pipelines, and strategic brand positioning.
                </p>
              </div>
              <div className="border border-border bg-[#080808] p-6 rounded-lg flex flex-col gap-3">
                <Cpu className="size-6 text-primary" />
                <h3 className="font-sans font-bold text-lg">AI & Automation</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  Custom AI integration, workflow automation, and internal tooling to accelerate production speed and scale output.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Brand Promise Section */}
        <section id="about" className="py-20 px-6 md:px-12 max-w-5xl mx-auto flex flex-col md:flex-row gap-10 items-center justify-between">
          <div className="flex flex-col gap-4 max-w-lg">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary font-bold">Philosophy</span>
            <h2 className="font-sans font-extrabold text-3xl sm:text-4xl tracking-tight leading-snug">
              Your Space.<br />Our Direction.<br />Extraordinary Portraits.
            </h2>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              We collaborate closely with creatives, innovators, and brands to turn visions into high-impact digital products. Every deliverable is refined until it stands out.
            </p>
          </div>
          <div className="w-full md:w-96 aspect-video bg-gradient-to-tr from-primary/10 to-card border border-border rounded-lg flex items-center justify-center p-8 text-center">
            <p className="font-mono text-[11px] uppercase tracking-widest text-primary font-semibold leading-relaxed">
              &ldquo;Where Every Frame Tells a Story&rdquo;
            </p>
          </div>
        </section>

        {/* 5. How We Work Section */}
        <section id="work" className="bg-[#131313] border-t border-border py-20 px-6 md:px-12">
          <div className="max-w-5xl mx-auto flex flex-col gap-12">
            <div className="flex flex-col gap-2 max-w-xl">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary font-bold">Methodology</span>
              <h2 className="font-sans font-extrabold text-3xl tracking-tight">How We Work</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { step: "01", title: "Discover", desc: "Understanding the brand strategy, goals, and content targets." },
                { step: "02", title: "Create", desc: "Developing elite media assets, scripts, and automation pipelines." },
                { step: "03", title: "Refine", desc: "Testing, editing, and checking quality constraints." },
                { step: "04", title: "Deliver", desc: "Deploying production-ready social media content and systems." },
              ].map((w) => (
                <div key={w.step} className="border border-border/50 bg-[#080808] p-5 rounded-lg flex flex-col gap-2.5">
                  <span className="font-mono text-sm text-primary font-bold">{w.step}</span>
                  <h3 className="font-sans font-bold text-white text-[15px]">{w.title}</h3>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">{w.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 6. Contact CTA Section */}
        <section id="contact" className="py-24 px-6 md:px-12 max-w-3xl mx-auto flex flex-col items-center text-center gap-6">
          <MessageSquare className="size-8 text-primary" />
          <h2 className="font-sans font-extrabold text-3xl tracking-tight">Ready to Work with Us?</h2>
          <p className="text-[13px] text-muted-foreground max-w-md leading-relaxed">
            Reach out directly for media production, strategy, brand content, or custom AI integration projects.
          </p>
          <a 
            href="mailto:inquiries@villizpixels.com"
            className="bg-primary hover:bg-primary-hover text-white text-[13px] font-bold px-8 py-3 rounded-md transition-colors"
          >
            inquiries@villizpixels.com
          </a>
        </section>
      </main>

      {/* 7. Footer */}
      <footer className="bg-[#080808] border-t border-border py-8 px-6 md:px-12 flex flex-col sm:flex-row justify-between items-center gap-4 text-[12px] text-muted-foreground">
        <div>
          <span>© {new Date().getFullYear()} Villiz Pixels. All rights reserved.</span>
        </div>
        <div className="flex gap-6 items-center">
          <Link href="/login" className="hover:text-white transition-colors">Staff Portal</Link>
        </div>
      </footer>
    </div>
  );
}

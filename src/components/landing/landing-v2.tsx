"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles, MessageSquare, ArrowUpRight, Menu, X } from "lucide-react";

// 1. PublicHeader
export function PublicHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 border-b ${
      scrolled 
        ? "bg-[#050505]/85 backdrop-blur-md border-border py-4" 
        : "bg-transparent border-transparent py-6"
    } px-6 md:px-12 flex justify-between items-center`}>
      <Link href="/" className="flex items-center gap-2.5 group">
        <span aria-hidden className="size-2.5 rounded-full bg-primary transition-transform group-hover:scale-125" />
        <span className="font-mono text-sm font-bold uppercase tracking-[0.25em] text-white">Villiz Pixels</span>
      </Link>

      <nav className="hidden md:flex items-center gap-8 text-[12px] text-muted-foreground uppercase tracking-widest font-semibold">
        <a href="#work" className="link-underline hover:text-white transition-colors">Work</a>
        <a href="#services" className="link-underline hover:text-white transition-colors">Services</a>
        <a href="#philosophy" className="link-underline hover:text-white transition-colors">Philosophy</a>
        <a href="#process" className="link-underline hover:text-white transition-colors">Process</a>
        <a href="#why-villiz" className="link-underline hover:text-white transition-colors">Why Villiz</a>
        <a href="#contact" className="link-underline hover:text-white transition-colors">Contact</a>
      </nav>

      <div className="hidden md:block">
        <Link 
          href="/login"
          className="border border-border/80 hover:border-primary/50 hover:bg-primary/5 hover:text-white text-muted-foreground text-[11px] font-bold uppercase tracking-wider px-4 py-2 rounded transition-all duration-200"
        >
          Staff Portal
        </Link>
      </div>

      {/* Mobile Toggle */}
      <button 
        onClick={() => setMobileOpen(!mobileOpen)} 
        aria-label="Toggle menu"
        className="md:hidden text-white hover:text-primary transition-colors cursor-pointer"
      >
        {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="absolute top-full inset-x-0 bg-[#080808] border-b border-border py-6 px-6 flex flex-col gap-5 animate-in-fast md:hidden">
          <nav className="flex flex-col gap-4 text-[13px] font-bold tracking-wide">
            <a href="#work" onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-white">Work</a>
            <a href="#services" onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-white">Services</a>
            <a href="#philosophy" onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-white">Philosophy</a>
            <a href="#process" onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-white">Process</a>
            <a href="#why-villiz" onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-white">Why Villiz</a>
            <a href="#contact" onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-white">Contact</a>
          </nav>
          <div className="border-t border-border pt-4">
            <Link 
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="inline-block text-[12px] font-bold text-primary uppercase tracking-wider"
            >
              Staff Portal →
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

// 2. HeroSection
export function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col justify-center items-center px-6 md:px-12 text-center overflow-hidden bg-gradient-to-b from-[#050505] to-[#080808]">
      {/* Subtle brand glow overlay */}
      <div aria-hidden className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px] pointer-events-none animate-ambient" />

      <div className="max-w-5xl mx-auto flex flex-col items-center gap-8 relative z-10">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-primary font-bold animate-reveal-1">
          CREATIVE PRODUCTION & MARKETING
        </span>
        <h1 className="font-sans font-extrabold text-4xl sm:text-7xl tracking-tight leading-[1.05] max-w-4xl text-white animate-reveal-2">
          Where Every Frame <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-orange-400">Tells a Story.</span>
        </h1>
        <p className="text-[14px] sm:text-lg text-muted-foreground max-w-2xl leading-relaxed mt-2 font-medium animate-reveal-3">
          We help brands, businesses and people create images, campaigns and digital experiences that remain memorable long after the moment has passed.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 mt-6 w-full sm:w-auto justify-center animate-reveal-4">
          <a 
            href="#work" 
            className="bg-primary hover:bg-primary-hover text-white text-[13px] font-bold tracking-wide uppercase px-8 py-4 rounded transition-colors flex items-center justify-center gap-2 cursor-pointer transform hover:-translate-y-0.5 transition-transform duration-200"
          >
            Explore Our Work <ArrowRight className="size-4" />
          </a>
          <a 
            href="#contact" 
            className="bg-card hover:bg-[#1a1a1a] border border-border text-white text-[13px] font-bold tracking-wide uppercase px-8 py-4 rounded transition-colors text-center cursor-pointer transform hover:-translate-y-0.5 transition-transform duration-200"
          >
            Start a Project
          </a>
        </div>
        <a href="#philosophy" className="mt-12 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle-foreground hover:text-white transition-colors cursor-pointer animate-reveal-4">
          Meet Villiz ↓
        </a>
      </div>
    </section>
  );
}

// 3. SelectedWork
export function SelectedWork() {
  const works = [
    { title: "Sovereign Portraits", cat: "Portraits", year: "2026", ratio: "md:col-span-2 aspect-[16/9]" },
    { title: "Momentum Summit", cat: "Events", year: "2025", ratio: "aspect-square" },
    { title: "Eternal Union", cat: "Wed weddings", year: "2026", ratio: "aspect-[4/5]" },
    { title: "Omni Brand Campaign", cat: "Branding", year: "2025", ratio: "md:col-span-2 aspect-[16/9]" },
    { title: "Kinetic Commerce", cat: "Commercial", year: "2026", ratio: "aspect-square" },
    { title: "Genesis Automation Studio", cat: "Creative Campaigns", year: "2026", ratio: "md:col-span-3 aspect-[21/9]" },
  ];

  return (
    <section id="work" className="bg-[#050505] border-y border-border py-24 px-6 md:px-12">
      <div className="max-w-6xl mx-auto flex flex-col gap-16">
        <div className="flex justify-between items-end border-b border-border pb-8">
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary font-bold">PORTFOLIO</span>
            <h2 className="font-sans font-extrabold text-3xl sm:text-5xl tracking-tight text-white">Selected Work</h2>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground hidden sm:inline-block">MAGAZINE EDITORIAL GRID V2</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {works.map((w, idx) => (
            <div 
              key={idx} 
              className={`group relative overflow-hidden bg-[#101010] border border-border/80 rounded transition-all duration-300 hover:border-primary/30 flex flex-col justify-end p-6 ${w.ratio}`}
            >
              {/* Dark portfolio placeholder pattern */}
              <div aria-hidden className="absolute inset-0 bg-radial from-primary/5 via-transparent to-transparent opacity-60 group-hover:opacity-85 transition-opacity" />
              <div aria-hidden className="absolute inset-0 flex items-center justify-center font-mono text-[9px] uppercase tracking-widest text-subtle-foreground/30">
                {/* TODO: replace with approved Villiz portfolio image */}
                [ portfolio_slot_{idx + 1} ]
              </div>
              
              <div className="relative z-10 mt-auto flex flex-col gap-1.5 opacity-85 group-hover:opacity-100 transition-opacity">
                <div className="flex justify-between items-center text-[10px] font-mono text-primary font-bold uppercase tracking-wider">
                  <span>{w.cat}</span>
                  <span>{w.year}</span>
                </div>
                <h3 className="font-sans font-bold text-lg sm:text-xl text-white tracking-tight flex items-center gap-1.5">
                  {w.title} <ArrowUpRight className="size-4 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                </h3>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// 4. ServicesSection
export function ServicesSection() {
  const services = [
    {
      num: "01",
      title: "MEDIA",
      desc: "Photography, film, creative production and visual storytelling directed with precision and artistic intent.",
      sub: ["Executive Portraits", "Brand Video", "Event Journalism"]
    },
    {
      num: "02",
      title: "MARKETING",
      desc: "Brand strategy, campaign development and social content systems created to move audiences and grow attention.",
      sub: ["Social Content Systems", "Strategic Positioning", "Copywriting"]
    },
    {
      num: "03",
      title: "AI INTEGRATION & AUTOMATION",
      desc: "Intelligent tools and automated workflows designed to accelerate production, improve consistency and scale creative operations.",
      sub: ["Content Generation Engines", "Workflow Automation", "Awo Strategy Support"]
    }
  ];

  return (
    <section id="services" className="bg-[#080808] py-24 px-6 md:px-12 border-b border-border">
      <div className="max-w-5xl mx-auto flex flex-col gap-16">
        <div className="flex flex-col gap-3 max-w-xl">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary font-bold">CAPABILITIES</span>
          <h2 className="font-sans font-extrabold text-3xl sm:text-5xl tracking-tight text-white">Core Services</h2>
        </div>

        <div className="flex flex-col border-t border-border">
          {services.map((s, idx) => (
            <div 
              key={idx} 
              className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-8 py-10 border-b border-border group hover:bg-primary/[0.01] transition-all px-4 rounded"
            >
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-sm text-primary font-bold">{s.num}</span>
                <h3 className="font-sans font-extrabold text-xl sm:text-2xl text-white tracking-wider group-hover:text-primary transition-colors">
                  {s.title}
                </h3>
              </div>
              <div className="flex flex-col gap-5">
                <p className="text-[14px] sm:text-[15px] text-muted-foreground leading-relaxed max-w-xl">
                  {s.desc}
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {s.sub.map((tag, i) => (
                    <span key={i} className="bg-[#101010] border border-border font-mono text-[10px] uppercase tracking-wider text-subtle-foreground px-3 py-1 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// 5. BrandPhilosophy
export function BrandPhilosophy() {
  return (
    <section id="philosophy" className="relative py-28 px-6 md:px-12 bg-[#050505] overflow-hidden border-b border-border">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-12 items-center">
        <div className="flex flex-col gap-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary font-bold">PHILOSOPHY</span>
          <h2 className="font-sans font-extrabold text-4xl sm:text-6xl tracking-tight leading-[1.1] text-white">
            Your Space.<br />
            Our Direction.<br />
            <span className="text-primary">Extraordinary Portraits.</span>
          </h2>
          <p className="text-[14px] sm:text-[15px] text-muted-foreground leading-relaxed max-w-xl mt-2">
            We bring creative direction, technical precision and human understanding into every production. The goal is not simply to capture an image, but to create a frame with meaning.
          </p>
        </div>
        <div className="border border-border bg-[#101010] p-10 rounded aspect-square flex flex-col justify-center items-center text-center relative group">
          <div aria-hidden className="absolute inset-0 bg-radial from-primary/5 to-transparent opacity-80" />
          <Sparkles className="size-8 text-primary mb-4 animate-bounce" />
          <p className="font-mono text-[12px] uppercase tracking-[0.25em] text-white font-bold leading-relaxed max-w-xs relative z-10">
            &ldquo;Where Every Frame Tells a Story&rdquo;
          </p>
        </div>
      </div>
    </section>
  );
}

// 6. ProcessSection
export function ProcessSection() {
  const steps = [
    { num: "01", title: "Discover", desc: "We understand the story, audience, objective and atmosphere." },
    { num: "02", title: "Create", desc: "We shape the visual direction and produce with purpose." },
    { num: "03", title: "Refine", desc: "Every detail is reviewed, edited and strengthened." },
    { num: "04", title: "Deliver", desc: "Final assets are prepared for impact across every required channel." },
  ];

  return (
    <section id="process" className="bg-[#080808] py-24 px-6 md:px-12 border-b border-border">
      <div className="max-w-5xl mx-auto flex flex-col gap-16">
        <div className="flex flex-col gap-3 max-w-xl">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary font-bold">METHODOLOGY</span>
          <h2 className="font-sans font-extrabold text-3xl sm:text-5xl tracking-tight text-white">How We Work</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((s, idx) => (
            <div key={idx} className="border border-border/60 bg-[#101010] p-6 rounded flex flex-col gap-4 group hover:border-primary/20 transition-all duration-300">
              <span className="font-mono text-sm text-primary font-bold">{s.num}</span>
              <h3 className="font-sans font-bold text-white text-base tracking-wide border-b border-border pb-2 group-hover:text-primary transition-colors">
                {s.title}
              </h3>
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// 7. WhyVilliz
export function WhyVilliz() {
  const pillars = [
    { char: "V", word: "Vision", desc: "Creative direction that shapes distinct realities." },
    { char: "L", word: "Leadership", desc: "Commanding visual execution and strategic oversight." },
    { char: "L", word: "Light", desc: "Technical mastery of contrast, clarity, and perspective." },
    { char: "Z", word: "Zeal", desc: "Untiring focus and dedication to extraordinary details." }
  ];

  return (
    <section id="why-villiz" className="bg-[#050505] py-24 px-6 md:px-12 border-b border-border">
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-12 items-start">
        <div className="flex flex-col gap-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary font-bold">IDENTITY</span>
          <h2 className="font-sans font-extrabold text-3xl sm:text-5xl tracking-tight text-white leading-tight">Why Villiz</h2>
          <p className="text-[13px] text-muted-foreground leading-relaxed max-w-sm mt-2">
            We do not just execute visual production — we combine strategy, design, and automation to elevate storytelling.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {pillars.map((p, idx) => (
            <div key={idx} className="border border-border bg-[#101010] p-6 rounded flex items-start gap-4">
              <span className="font-mono text-3xl font-extrabold text-primary">{p.char}</span>
              <div className="flex flex-col gap-1">
                <strong className="text-white font-sans text-[15px] font-bold tracking-wide">{p.word}</strong>
                <span className="text-[12px] text-muted-foreground leading-relaxed">{p.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// 8. TrustSection
export function TrustSection() {
  return (
    <section className="bg-[#080808] py-20 px-6 md:px-12 border-b border-border">
      <div className="max-w-5xl mx-auto flex flex-col gap-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div className="border border-border/80 bg-[#101010] py-6 px-4 rounded">
            <span className="font-mono text-[9px] uppercase tracking-wider text-subtle-foreground block">Projects Delivered</span>
            <span className="font-mono text-2xl font-bold text-white mt-1 block">[ Pending Data ]</span>
            {/* TODO: replace with verified Villiz business metrics */}
          </div>
          <div className="border border-border/80 bg-[#101010] py-6 px-4 rounded">
            <span className="font-mono text-[9px] uppercase tracking-wider text-subtle-foreground block">Returning Clients</span>
            <span className="font-mono text-2xl font-bold text-white mt-1 block">[ Pending Data ]</span>
          </div>
          <div className="border border-border/80 bg-[#101010] py-6 px-4 rounded">
            <span className="font-mono text-[9px] uppercase tracking-wider text-subtle-foreground block">Creative Campaigns</span>
            <span className="font-mono text-2xl font-bold text-white mt-1 block">[ Pending Data ]</span>
          </div>
          <div className="border border-border/80 bg-[#101010] py-6 px-4 rounded">
            <span className="font-mono text-[9px] uppercase tracking-wider text-subtle-foreground block">Years Combined Exp</span>
            <span className="font-mono text-2xl font-bold text-white mt-1 block">[ Pending Data ]</span>
          </div>
        </div>

        <div className="flex flex-col gap-4 text-center mt-6">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle-foreground">PARTNERS & MENTIONS</span>
          <div className="flex flex-wrap justify-center gap-10 items-center opacity-30 mt-2">
            <span className="font-mono text-xs uppercase tracking-widest text-white">[ Logo Space 1 ]</span>
            <span className="font-mono text-xs uppercase tracking-widest text-white">[ Logo Space 2 ]</span>
            <span className="font-mono text-xs uppercase tracking-widest text-white">[ Logo Space 3 ]</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// 9. ClientStories
export function ClientStories() {
  return (
    <section className="bg-[#050505] py-24 px-6 md:px-12 border-b border-border">
      <div className="max-w-5xl mx-auto flex flex-col gap-12">
        <div className="flex flex-col gap-2 max-w-xl">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary font-bold">CLIENT EXPERIENCE</span>
          <h2 className="font-sans font-extrabold text-3xl tracking-tight text-white">Client Stories</h2>
        </div>

        <div className="border border-border bg-[#101010] p-10 rounded flex flex-col gap-4 max-w-3xl relative">
          <span className="font-mono text-[10px] uppercase tracking-wider text-primary font-bold">TESTIMONIAL</span>
          <p className="font-sans italic text-muted-foreground text-sm leading-relaxed">
            &ldquo;Client testimonial will appear here.&rdquo;
          </p>
          <div className="border-t border-border pt-4 mt-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">
              {/* TODO: replace with approved client testimonial */}
              [ Pending Verification ]
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// 10. FinalCTA
export function FinalCTA() {
  return (
    <section id="contact" className="relative py-28 px-6 md:px-12 text-center bg-gradient-to-t from-[#050505] to-[#080808] border-b border-border overflow-hidden">
      <div aria-hidden className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[400px] h-[400px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      
      <div className="max-w-3xl mx-auto flex flex-col items-center gap-6 relative z-10">
        <MessageSquare className="size-8 text-primary animate-pulse" />
        <h2 className="font-sans font-extrabold text-3xl sm:text-5xl tracking-tight text-white leading-tight">
          Let&apos;s create something<br />worth remembering.
        </h2>
        <p className="text-[13px] sm:text-sm text-muted-foreground max-w-md leading-relaxed mt-1">
          Tell us what you are building, celebrating or imagining. We will help you turn it into a story people can see and feel.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 mt-4 w-full sm:w-auto">
          <a 
            href="mailto:inquiries@villizpixels.com"
            className="bg-primary hover:bg-primary-hover text-white text-[13px] font-bold tracking-wide uppercase px-8 py-3.5 rounded transition-colors cursor-pointer"
          >
            Start a Project
          </a>
          <a 
            href="mailto:inquiries@villizpixels.com"
            className="bg-card hover:bg-[#1a1a1a] border border-border text-white text-[13px] font-bold tracking-wide uppercase px-8 py-3.5 rounded transition-colors cursor-pointer"
          >
            Contact Villiz
          </a>
        </div>
      </div>
    </section>
  );
}

// 11. PublicFooter
export function PublicFooter() {
  return (
    <footer className="bg-[#050505] py-16 px-6 md:px-12 border-t border-border">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12 text-[12px] text-muted-foreground">
        
        {/* Brand statement */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full bg-primary" />
            <strong className="font-mono text-white text-sm uppercase tracking-[0.2em]">Villiz Pixels</strong>
          </div>
          <p className="text-[11px] leading-relaxed max-w-xs">
            Where Every Frame Tells a Story. A premium creative studio shaping media and strategic campaigns.
          </p>
          <span className="text-[11px] text-subtle-foreground mt-4">
            © {new Date().getFullYear()} Villiz Pixels. All rights reserved.
          </span>
        </div>

        {/* Links */}
        <div className="flex flex-col gap-3">
          <strong className="font-mono text-white text-[11px] uppercase tracking-wider">Navigation</strong>
          <nav className="flex flex-col gap-2">
            <a href="#work" className="hover:text-white transition-colors">Work</a>
            <a href="#services" className="hover:text-white transition-colors">Services</a>
            <a href="#philosophy" className="hover:text-white transition-colors">About</a>
            <a href="#process" className="hover:text-white transition-colors">Process</a>
            <a href="#contact" className="hover:text-white transition-colors">Contact</a>
            <Link href="/login" className="hover:text-white transition-colors">Staff Portal</Link>
          </nav>
        </div>

        {/* Capabilities */}
        <div className="flex flex-col gap-3">
          <strong className="font-mono text-white text-[11px] uppercase tracking-wider">Capabilities</strong>
          <ul className="flex flex-col gap-2">
            <li>Media Production</li>
            <li>Marketing Systems</li>
            <li>AI Integration & Automation</li>
          </ul>
        </div>

      </div>
    </footer>
  );
}

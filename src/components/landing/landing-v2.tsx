"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Menu, X } from "lucide-react";

const navigation = [
  { href: "#workflow", label: "Workflow" },
  { href: "#capabilities", label: "Capabilities" },
  { href: "#controls", label: "Controls" },
  { href: "#proof", label: "Release proof" },
];

// 1. PublicHeader
export function PublicHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b px-6 transition-all duration-300 md:px-12 ${
        scrolled
          ? "border-border bg-[#050505]/85 py-4 backdrop-blur-md"
          : "border-transparent bg-transparent py-6"
      }`}
    >
      <Link href="/" className="group flex items-center gap-2.5" aria-label="Villiz Genesis home">
        <span aria-hidden className="size-2.5 rounded-full bg-primary transition-transform group-hover:scale-125" />
        <span className="font-mono text-sm font-bold uppercase tracking-[0.25em] text-white">Villiz</span>
      </Link>

      <nav className="hidden items-center gap-8 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground md:flex" aria-label="Primary navigation">
        {navigation.map((item) => (
          <a key={item.href} href={item.href} className="link-underline transition-colors hover:text-white">
            {item.label}
          </a>
        ))}
      </nav>

      <Link
        href="/login"
        className="hidden rounded border border-border/80 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-all duration-200 hover:border-primary/50 hover:bg-primary/5 hover:text-white md:block"
      >
        Staff access
      </Link>

      <button
        type="button"
        onClick={() => setMobileOpen((open) => !open)}
        aria-expanded={mobileOpen}
        aria-controls="mobile-navigation"
        aria-label="Toggle navigation"
        className="cursor-pointer text-white transition-colors hover:text-primary md:hidden"
      >
        {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {mobileOpen && (
        <div id="mobile-navigation" className="animate-in-fast absolute inset-x-0 top-full flex flex-col gap-5 border-b border-border bg-[#080808] px-6 py-6 md:hidden">
          <nav className="flex flex-col gap-4 text-[12px] font-bold uppercase tracking-wider" aria-label="Mobile navigation">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-white">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="border-t border-border pt-4">
            <Link href="/login" onClick={() => setMobileOpen(false)} className="text-[12px] font-bold uppercase tracking-wider text-primary">
              Open the Console →
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
    <section className="relative flex min-h-screen items-center overflow-hidden bg-gradient-to-b from-[#050505] to-[#080808] px-6 pb-20 pt-32 md:px-12">
      <div aria-hidden className="animate-ambient pointer-events-none absolute left-1/2 top-1/3 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.07] blur-[130px]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] [background-size:72px_72px]" />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-16 lg:grid-cols-[3fr_2fr] lg:items-end">
        <div className="flex max-w-4xl flex-col items-start gap-8">
          <span className="animate-reveal-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-primary">
            VILLIZ · STAFF ACCESS ONLY
          </span>
          <h1 className="animate-reveal-2 bg-gradient-to-r from-white via-white to-orange-400 bg-clip-text font-sans text-5xl font-extrabold leading-[0.98] tracking-[-0.045em] text-transparent sm:text-7xl lg:text-[5.5rem]">
            Genesis — Villiz Social Media Manager.
          </h1>
          <p className="animate-reveal-3 max-w-2xl text-base font-medium leading-relaxed text-muted-foreground sm:text-lg">
            One story enters as a single message. Genesis turns it into scheduled, approved, published work — the operating layer behind every client account Villiz runs.
          </p>
          <div className="animate-reveal-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Link href="/login" className="flex items-center gap-2 rounded bg-primary px-7 py-4 text-[12px] font-bold uppercase tracking-wider text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-hover">
              Open the Console <ArrowRight className="size-4" />
            </Link>
            <span className="max-w-xs font-mono text-[10px] leading-relaxed uppercase tracking-[0.16em] text-subtle-foreground">
              Staff access is granted by a platform administrator.
            </span>
          </div>
        </div>

        <div className="animate-reveal-4 border-l border-primary/40 pl-6 lg:mb-2">
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.25em] text-primary">The quiet operating layer</span>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Intake, selection, approval, publishing and proof — held in one controlled path from the first message to the live feed.
          </p>
        </div>
      </div>
    </section>
  );
}

// 3. SelectedWork
export function SelectedWork() {
  const stages = [
    { number: "01", title: "Message", detail: "A story arrives once." },
    { number: "02", title: "Pick", detail: "The engine shortlists what goes next." },
    { number: "03", title: "Approve", detail: "The owner gives the final yes." },
    { number: "04", title: "Publish", detail: "A verified platform door opens." },
  ];

  return (
    <section id="workflow" className="border-y border-border bg-[#050505] px-6 py-24 md:px-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-14">
        <div className="grid gap-6 border-b border-border pb-8 md:grid-cols-2 md:items-end">
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">One continuous story</span>
            <h2 className="font-sans text-3xl font-extrabold tracking-tight text-white sm:text-5xl">From message to live.</h2>
          </div>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground md:justify-self-end">
            No client dashboard. No scattered hand-offs. Genesis carries the work through a deliberate staff-owned sequence.
          </p>
        </div>

        <div className="grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {stages.map((stage) => (
            <article key={stage.number} className="group min-h-52 bg-[#0b0b0b] p-7 transition-colors hover:bg-[#101010]">
              <span className="font-mono text-[10px] font-bold tracking-wider text-primary">{stage.number}</span>
              <h3 className="mt-14 text-xl font-bold tracking-tight text-white">{stage.title}</h3>
              <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">{stage.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// 4. ServicesSection
export function ServicesSection() {
  const capabilities = [
    { number: "01", title: "One-message intake", detail: "One message in; the brief, client and folder are picked up automatically." },
    { number: "02", title: "Picks Queue", detail: "The engine shortlists the next posts and keeps the editorial sequence moving." },
    { number: "03", title: "Owner approvals", detail: "Reviews wait for the owner’s yes before anything leaves." },
    { number: "04", title: "One-tap publishing", detail: "Publishing is gated per platform driver, never assumed." },
    { number: "05", title: "Analytics + scorecard", detail: "Performance, scorecard and live feeds stay visible in the operating view." },
    { number: "06", title: "Fail-closed receipts", detail: "Nothing publishes on an unverified receipt." },
    { number: "07", title: "Multi-org", detail: "Villiz Media and Mervic Signatures are live in separate organisation contexts." },
  ];

  return (
    <section id="capabilities" className="border-b border-border bg-[#080808] px-6 py-24 md:px-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-16">
        <div className="max-w-2xl">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Shipped system</span>
          <h2 className="mt-4 font-sans text-3xl font-extrabold tracking-tight text-white sm:text-5xl">The work, held together.</h2>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
            Every capability below is part of the live Genesis operating path — no speculative modules, no decorative promises.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability, index) => (
            <article key={capability.number} className={`rounded border border-border/80 bg-[#101010] p-7 transition-colors hover:border-primary/30 ${index === capabilities.length - 1 ? "lg:col-span-3" : ""}`}>
              <div className="flex items-center justify-between border-b border-border pb-5">
                <span className="font-mono text-[10px] font-bold text-primary">{capability.number}</span>
                <span aria-hidden className="size-1.5 rounded-full bg-primary/60" />
              </div>
              <h3 className="mt-6 text-lg font-bold tracking-tight text-white">{capability.title}</h3>
              <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-muted-foreground">{capability.detail}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// 5. BrandPhilosophy
export function BrandPhilosophy() {
  return (
    <section id="controls" className="relative overflow-hidden border-b border-border bg-[#050505] px-6 py-28 md:px-12">
      <div aria-hidden className="pointer-events-none absolute right-0 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full bg-primary/5 blur-[100px]" />
      <div className="relative mx-auto grid max-w-6xl gap-12 lg:grid-cols-[3fr_2fr] lg:items-center">
        <div>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Access by design</span>
          <h2 className="mt-5 max-w-3xl font-sans text-4xl font-extrabold leading-[1.05] tracking-tight text-primary sm:text-6xl">
            We sign in, clients never do.
          </h2>
        </div>
        <div className="rounded border border-border bg-[#101010] p-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Genesis is a Villiz staff tool. Client stories move through the operating layer while account access, review and release remain with the team responsible for the work.
          </p>
          <div className="mt-7 border-t border-border pt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle-foreground">
            Owner approval remains the release boundary
          </div>
        </div>
      </div>
    </section>
  );
}

// 6. ProcessSection
export function ProcessSection() {
  const platforms = ["Instagram", "TikTok", "Facebook", "YouTube"];

  return (
    <section className="border-b border-border bg-[#080808] px-6 py-24 md:px-12">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[2fr_3fr] lg:items-end">
        <div>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Publishing drivers</span>
          <h2 className="mt-4 font-sans text-3xl font-extrabold tracking-tight text-white sm:text-5xl">Four doors. Each gated.</h2>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
            Instagram · TikTok · Facebook · YouTube. More doors stay gated until their drivers go live.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {platforms.map((platform) => (
            <div key={platform} className="rounded border border-border bg-[#101010] px-4 py-7 text-center">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white">{platform}</span>
              <span className="mt-3 block font-mono text-[9px] uppercase tracking-widest text-primary">Driver gate</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// 7. WhyVilliz
export function WhyVilliz() {
  return (
    <section className="border-b border-border bg-[#050505] px-6 py-24 md:px-12">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2">
        <div className="flex flex-col justify-between rounded border border-border bg-[#101010] p-8 sm:p-10">
          <div>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Multi-organisation</span>
            <h2 className="mt-5 font-sans text-3xl font-extrabold tracking-tight text-white sm:text-5xl">One operating layer. Distinct client contexts.</h2>
          </div>
          <p className="mt-10 max-w-lg text-sm leading-relaxed text-muted-foreground">
            The system keeps the organisation in view as work moves from intake through publication.
          </p>
        </div>
        <div className="grid gap-4">
          {["Villiz Media", "Mervic Signatures"].map((organisation, index) => (
            <div key={organisation} className="flex items-center justify-between rounded border border-border/80 bg-[#0b0b0b] p-7">
              <div>
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle-foreground">Live organisation {String(index + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 text-xl font-bold text-white">{organisation}</h3>
              </div>
              <span aria-label="Live" className="size-2 rounded-full bg-primary shadow-[0_0_18px_rgba(249,115,22,0.6)]" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// 8. TrustSection
export function TrustSection() {
  const evidence = [
    { value: "1,952", label: "1,952-test release gate" },
    { value: "48h", label: "48-hour staging soak passed" },
    { value: "02", label: "2 client organisations live" },
    { value: "04", label: "4 platform doors" },
  ];

  return (
    <section id="proof" className="border-b border-border bg-[#080808] px-6 py-20 md:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-9 flex items-end justify-between gap-6">
          <div>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Verified release state</span>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white">Proof before publication.</h2>
          </div>
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.2em] text-subtle-foreground sm:block">Observed gates · not business metrics</span>
        </div>
        <div className="grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {evidence.map((item) => (
            <div key={item.label} className="bg-[#101010] px-6 py-7">
              <strong className="font-mono text-3xl text-white">{item.value}</strong>
              <span className="mt-3 block text-[11px] leading-relaxed text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// 9. ClientStories
export function ClientStories() {
  return (
    <section className="border-b border-border bg-[#050505] px-6 py-24 md:px-12">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[2fr_3fr] lg:items-center">
        <div>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">The operating view</span>
          <h2 className="mt-4 font-sans text-3xl font-extrabold tracking-tight text-white sm:text-5xl">See what moved. Know what landed.</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {["Analytics", "Scorecard", "Live feeds"].map((view) => (
            <div key={view} className="rounded border border-border bg-[#101010] p-6">
              <span aria-hidden className="mb-8 block h-px w-8 bg-primary" />
              <h3 className="text-sm font-bold text-white">{view}</h3>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// 10. FinalCTA
export function FinalCTA() {
  return (
    <section className="relative overflow-hidden border-b border-border bg-gradient-to-t from-[#050505] to-[#080808] px-6 py-28 text-center md:px-12">
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-primary/5 blur-[110px]" />
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center gap-6">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-primary">Villiz staff</span>
        <h2 className="font-sans text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-6xl">Your next story starts inside.</h2>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          Access is granted by a platform administrator. Approved staff can continue to the Genesis console.
        </p>
        <Link href="/login" className="mt-3 flex items-center gap-2 rounded bg-primary px-8 py-4 text-[12px] font-bold uppercase tracking-wider text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-hover">
          Open the Console <ArrowRight className="size-4" />
        </Link>
      </div>
    </section>
  );
}

// 11. PublicFooter
export function PublicFooter() {
  return (
    <footer className="border-t border-border bg-[#050505] px-6 py-14 md:px-12">
      <div className="mx-auto grid max-w-6xl gap-12 text-[12px] text-muted-foreground md:grid-cols-[2fr_1fr_2fr]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full bg-primary" />
            <strong className="font-mono text-sm uppercase tracking-[0.2em] text-white">Villiz</strong>
          </div>
          <p className="max-w-xs text-[11px] leading-relaxed">Genesis — the Villiz Social Media Manager.</p>
        </div>

        <div className="flex flex-col gap-3">
          <strong className="font-mono text-[10px] uppercase tracking-wider text-white">Navigate</strong>
          <nav className="flex flex-col gap-2" aria-label="Footer navigation">
            {navigation.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-white">{item.label}</a>
            ))}
            <Link href="/login" className="transition-colors hover:text-white">Staff access</Link>
          </nav>
        </div>

        <div className="flex flex-col justify-between gap-8 border-t border-border pt-6 md:border-l md:border-t-0 md:pl-8 md:pt-0">
          <a href="https://villizpixels.com" target="_blank" rel="noreferrer" className="group max-w-sm leading-relaxed text-muted-foreground transition-colors hover:text-white">
            Villiz Pixels has its own website — photography &amp; visual storytelling <ArrowUpRight className="ml-1 inline size-3 text-primary transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
          <div className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[9px] uppercase tracking-[0.16em] text-subtle-foreground">
            <span>© Villiz. All rights reserved.</span>
            <span>Powered by Villiz</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

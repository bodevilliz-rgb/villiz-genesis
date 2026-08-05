"use client";
import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Building2,
  Megaphone,
  Package,
  LayoutList,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { runSetupAssistantAction, type SetupPayload } from "@/server/actions/setup-assistant";
import { idleState } from "@/server/action-result";
import { routes } from "@/lib/routes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type WizardData = SetupPayload;

const INITIAL_DATA: WizardData = {
  businessName: "",
  industry: "",
  websiteUrl: "",
  location: "",
  brandColour: "#FF6A1F",
  mission: "",
  brandStory: "",
  brandVoice: "",
  tone: "",
  personality: "",
  targetAudience: "",
  products: "",
  services: "",
  keyOffers: "",
  uniqueSellingPoints: "",
  competitors: "",
  contentPillars: "",
  restrictions: "",
  preferredCTA: "",
  preferredPlatforms: "",
  postingFrequency: "",
};

const STEPS = [
  { id: 1, label: "Business", icon: Building2 },
  { id: 2, label: "Brand", icon: Megaphone },
  { id: 3, label: "Products", icon: Package },
  { id: 4, label: "Content", icon: LayoutList },
  { id: 5, label: "Review", icon: Eye },
] as const;

const GENESIS_READY_ITEMS = [
  { label: "Organisation Created", description: "Client account provisioned with MemBrain and storage." },
  { label: "MemBrain Populated", description: "Brand knowledge written and active for AI retrieval." },
  { label: "Prompt Library Ready", description: "5 default prompt templates created for your organisation." },
  { label: "Campaign Created", description: "Welcome Campaign in planning — ready for your team." },
  { label: "Content Calendar Generated", description: "Week 1: 5 draft ideas linked to the campaign." },
  { label: "AI Ready", description: "Content Studio can now generate on-brand content immediately." },
] as const;

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------
function BusinessStep({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <Field id="businessName" label="Business name" required>
        <Input
          id="businessName"
          value={data.businessName}
          onChange={(e) => onChange({ businessName: e.target.value })}
          placeholder="Northside Dental"
          maxLength={120}
          required
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="industry" label="Industry" hint="Optional">
          <Input
            id="industry"
            value={data.industry}
            onChange={(e) => onChange({ industry: e.target.value })}
            placeholder="Healthcare"
            maxLength={80}
          />
        </Field>

        <Field id="location" label="Location" hint="Optional">
          <Input
            id="location"
            value={data.location}
            onChange={(e) => onChange({ location: e.target.value })}
            placeholder="Sydney, NSW"
            maxLength={120}
          />
        </Field>

        <Field id="websiteUrl" label="Website" hint="Optional">
          <Input
            id="websiteUrl"
            type="url"
            value={data.websiteUrl}
            onChange={(e) => onChange({ websiteUrl: e.target.value })}
            placeholder="https://example.com"
          />
        </Field>

        <Field id="brandColour" label="Brand colour" hint="Used as the account identifier">
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Pick a brand colour"
              value={data.brandColour}
              onChange={(e) => onChange({ brandColour: e.target.value.toUpperCase() })}
              className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-input p-1"
            />
            <Input
              id="brandColour"
              value={data.brandColour}
              onChange={(e) => onChange({ brandColour: e.target.value })}
              placeholder="#FF6A1F"
              className="font-mono"
            />
          </div>
        </Field>
      </div>
    </div>
  );
}

function BrandStep({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <Field id="mission" label="Mission statement" hint="Optional">
        <Input
          id="mission"
          value={data.mission}
          onChange={(e) => onChange({ mission: e.target.value })}
          placeholder="To make dental care accessible and stress-free for every family."
          maxLength={1000}
        />
      </Field>

      <Field id="brandVoice" label="Brand voice" required>
        <Textarea
          id="brandVoice"
          value={data.brandVoice}
          onChange={(e) => onChange({ brandVoice: e.target.value })}
          placeholder="Warm, professional, reassuring. We explain complex things simply and never use medical jargon without explaining it."
          rows={3}
          maxLength={2000}
          required
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="tone" label="Tone" hint="Optional">
          <Input
            id="tone"
            value={data.tone}
            onChange={(e) => onChange({ tone: e.target.value })}
            placeholder="Friendly, empathetic, expert"
            maxLength={200}
          />
        </Field>

        <Field id="personality" label="Brand personality" hint="Optional">
          <Input
            id="personality"
            value={data.personality}
            onChange={(e) => onChange({ personality: e.target.value })}
            placeholder="The knowledgeable neighbour you trust"
            maxLength={500}
          />
        </Field>
      </div>

      <Field id="targetAudience" label="Target audience" required>
        <Textarea
          id="targetAudience"
          value={data.targetAudience}
          onChange={(e) => onChange({ targetAudience: e.target.value })}
          placeholder="Families and working professionals aged 25–55 in Sydney's inner west. They value convenience and want to trust their provider, not just a clinic."
          rows={3}
          maxLength={2000}
          required
        />
      </Field>

      <Field id="brandStory" label="Brand story" hint="Optional — background and founding context">
        <Textarea
          id="brandStory"
          value={data.brandStory}
          onChange={(e) => onChange({ brandStory: e.target.value })}
          rows={4}
          maxLength={5000}
        />
      </Field>
    </div>
  );
}

function ProductsStep({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <Field id="products" label="Products" required>
        <Textarea
          id="products"
          value={data.products}
          onChange={(e) => onChange({ products: e.target.value })}
          placeholder="Dental checkups and cleans, teeth whitening, orthodontics (Invisalign), emergency dentistry."
          rows={3}
          maxLength={5000}
          required
        />
      </Field>

      <Field id="services" label="Services" hint="Optional">
        <Textarea
          id="services"
          value={data.services}
          onChange={(e) => onChange({ services: e.target.value })}
          placeholder="After-hours emergency line, payment plans via Afterpay, family appointment bundles."
          rows={3}
          maxLength={5000}
        />
      </Field>

      <Field id="keyOffers" label="Key offers or promotions" hint="Optional">
        <Input
          id="keyOffers"
          value={data.keyOffers}
          onChange={(e) => onChange({ keyOffers: e.target.value })}
          placeholder="Free first consultation for new patients"
          maxLength={2000}
        />
      </Field>

      <Field id="uniqueSellingPoints" label="Unique selling points" hint="Optional">
        <Textarea
          id="uniqueSellingPoints"
          value={data.uniqueSellingPoints}
          onChange={(e) => onChange({ uniqueSellingPoints: e.target.value })}
          placeholder="Only practice in the area offering same-day crowns. Family-run for 20 years. Anxiety-friendly environment."
          rows={3}
          maxLength={2000}
        />
      </Field>

      <Field id="competitors" label="Key competitors" hint="Optional">
        <Input
          id="competitors"
          value={data.competitors}
          onChange={(e) => onChange({ competitors: e.target.value })}
          placeholder="SmileCo, Inner West Dental Group"
          maxLength={2000}
        />
      </Field>
    </div>
  );
}

function ContentStep({ data, onChange }: { data: WizardData; onChange: (d: Partial<WizardData>) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <Field id="contentPillars" label="Content pillars" required hint="The recurring themes your content is built around">
        <Textarea
          id="contentPillars"
          value={data.contentPillars}
          onChange={(e) => onChange({ contentPillars: e.target.value })}
          placeholder="1. Patient education — how dental health affects overall wellbeing&#10;2. Behind the scenes — the team and practice culture&#10;3. Myth-busting — common misconceptions about dental care&#10;4. Community — local events and family stories"
          rows={5}
          maxLength={5000}
          required
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="preferredPlatforms" label="Preferred platforms" hint="Optional">
          <Input
            id="preferredPlatforms"
            value={data.preferredPlatforms}
            onChange={(e) => onChange({ preferredPlatforms: e.target.value })}
            placeholder="Instagram, Facebook"
            maxLength={500}
          />
        </Field>

        <Field id="postingFrequency" label="Posting frequency" hint="Optional">
          <Input
            id="postingFrequency"
            value={data.postingFrequency}
            onChange={(e) => onChange({ postingFrequency: e.target.value })}
            placeholder="3x per week"
            maxLength={200}
          />
        </Field>
      </div>

      <Field id="preferredCTA" label="Preferred call to action" hint="Optional">
        <Input
          id="preferredCTA"
          value={data.preferredCTA}
          onChange={(e) => onChange({ preferredCTA: e.target.value })}
          placeholder="Book online, call us, DM to ask a question"
          maxLength={500}
        />
      </Field>

      <Field id="restrictions" label="Content restrictions & compliance" hint="Optional — legal, regulatory, or client-mandated rules">
        <Textarea
          id="restrictions"
          value={data.restrictions}
          onChange={(e) => onChange({ restrictions: e.target.value })}
          placeholder="No before/after medical imagery without patient consent. AHPRA compliant — no claims of guaranteed outcomes. Avoid price comparisons with competitors."
          rows={4}
          maxLength={5000}
        />
      </Field>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 last:pb-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap text-[13px] text-foreground">{value}</dd>
    </div>
  );
}

function ReviewStep({ data }: { data: WizardData }) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">Business</h3>
        <dl className="flex flex-col gap-3">
          <ReviewItem label="Business name" value={data.businessName} />
          <ReviewItem label="Industry" value={data.industry ?? ""} />
          <ReviewItem label="Website" value={data.websiteUrl ?? ""} />
          <ReviewItem label="Location" value={data.location ?? ""} />
        </dl>
      </section>

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">Brand</h3>
        <dl className="flex flex-col gap-3">
          <ReviewItem label="Mission" value={data.mission ?? ""} />
          <ReviewItem label="Brand voice" value={data.brandVoice} />
          <ReviewItem label="Tone" value={data.tone ?? ""} />
          <ReviewItem label="Personality" value={data.personality ?? ""} />
          <ReviewItem label="Target audience" value={data.targetAudience} />
        </dl>
      </section>

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">Products</h3>
        <dl className="flex flex-col gap-3">
          <ReviewItem label="Products" value={data.products} />
          <ReviewItem label="Services" value={data.services ?? ""} />
          <ReviewItem label="Key offers" value={data.keyOffers ?? ""} />
          <ReviewItem label="Unique selling points" value={data.uniqueSellingPoints ?? ""} />
        </dl>
      </section>

      <section>
        <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-subtle-foreground">Content</h3>
        <dl className="flex flex-col gap-3">
          <ReviewItem label="Content pillars" value={data.contentPillars} />
          <ReviewItem label="Preferred platforms" value={data.preferredPlatforms ?? ""} />
          <ReviewItem label="Posting frequency" value={data.postingFrequency ?? ""} />
          <ReviewItem label="Preferred CTA" value={data.preferredCTA ?? ""} />
          <ReviewItem label="Restrictions" value={data.restrictions ?? ""} />
        </dl>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Genesis Ready screen
// ---------------------------------------------------------------------------
function GenesisReadyScreen({ orgId }: { orgId: string }) {
  return (
    <div className="flex flex-col items-center gap-8 py-4 text-center">
      <div className="flex flex-col items-center gap-3">
        <span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="size-8" />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight">Genesis Ready</h2>
        <p className="max-w-sm text-[13px] text-muted-foreground">
          Everything is set up and ready to use. Your AI can generate on-brand content immediately.
        </p>
      </div>

      <ul className="w-full max-w-md space-y-3 text-left">
        {GENESIS_READY_ITEMS.map((item) => (
          <li key={item.label} className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium">{item.label}</span>
              <span className="text-[12px] text-muted-foreground">{item.description}</span>
            </div>
          </li>
        ))}
      </ul>

      <Button asChild size="lg" variant="primary">
        <Link href={routes.organisations.content.index(orgId)}>
          Open Content Studio
          <ArrowRight aria-hidden className="ml-2 size-4" />
        </Link>
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------
function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <nav aria-label="Setup steps" className="flex items-center justify-center gap-2">
      {STEPS.map((step) => {
        const done = step.id < currentStep;
        const active = step.id === currentStep;
        return (
          <div key={step.id} className="flex items-center gap-2">
            <div
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex size-7 items-center justify-center rounded-full font-mono text-[11px] font-semibold transition-colors",
                done && "bg-primary text-primary-foreground",
                active && "bg-primary/20 text-primary ring-2 ring-primary ring-offset-1 ring-offset-background",
                !done && !active && "bg-muted text-muted-foreground",
              )}
            >
              {done ? <CheckCircle2 className="size-3.5" /> : step.id}
            </div>
            <span
              className={cn(
                "hidden text-[11px] sm:block",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {step.id < STEPS.length && (
              <div className={cn("mx-1 h-px w-6 sm:w-10", done ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Main wizard
// ---------------------------------------------------------------------------
export function SetupWizard() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [state, formAction] = useActionState(runSetupAssistantAction, idleState);
  const [, startTransition] = useTransition();

  const merge = (partial: Partial<WizardData>) => setData((prev) => ({ ...prev, ...partial }));

  const canAdvance = (): boolean => {
    if (step === 1) return data.businessName.trim().length >= 1;
    if (step === 2) return data.brandVoice.trim().length >= 1 && data.targetAudience.trim().length >= 1;
    if (step === 3) return data.products.trim().length >= 1;
    if (step === 4) return data.contentPillars.trim().length >= 1;
    return true;
  };

  const handleNext = () => {
    if (canAdvance() && step < STEPS.length) setStep((s) => s + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep((s) => s - 1);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("data", JSON.stringify(data));
    startTransition(() => formAction(fd));
  };

  if (state.status === "success" && state.resourceId) {
    return <GenesisReadyScreen orgId={state.resourceId} />;
  }

  const stepContent: Record<number, React.ReactNode> = {
    1: <BusinessStep data={data} onChange={merge} />,
    2: <BrandStep data={data} onChange={merge} />,
    3: <ProductsStep data={data} onChange={merge} />,
    4: <ContentStep data={data} onChange={merge} />,
    5: <ReviewStep data={data} />,
  };

  const stepTitles: Record<number, { title: string; description: string }> = {
    1: { title: "Business", description: "Start with the basics — what is this organisation and where does it operate?" },
    2: { title: "Brand", description: "Define the voice and identity that everything else will be built on." },
    3: { title: "Products & Services", description: "What does this business sell and what makes it different?" },
    4: { title: "Content Strategy", description: "Set the themes, platforms, and guardrails for every piece of content." },
    5: { title: "Review & Complete", description: "Confirm the details. Finishing creates the account, populates MemBrain, and generates the Welcome Campaign." },
  };

  const { title, description } = stepTitles[step]!;

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator currentStep={step} />

      <Card>
        <CardContent className="py-6">
          <div className="mb-6 flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="text-[13px] text-muted-foreground">{description}</p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            {stepContent[step]}

            {state.status === "error" && (
              <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
                {state.message}
              </p>
            )}

            <div className="mt-8 flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={handleBack}
                disabled={step === 1}
                className={cn(step === 1 && "invisible")}
              >
                <ArrowLeft aria-hidden className="mr-2 size-4" />
                Back
              </Button>

              {step < STEPS.length ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleNext}
                  disabled={!canAdvance()}
                >
                  Next
                  <ArrowRight aria-hidden className="ml-2 size-4" />
                </Button>
              ) : (
                <Button type="submit" variant="primary" size="lg">
                  Complete Setup
                  <CheckCircle2 aria-hidden className="ml-2 size-4" />
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

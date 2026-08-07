"use client";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Info, Sparkles } from "lucide-react";
import { createGenerationRequestAction } from "@/server/actions/content";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/common/form-message";
import type { ContentGenerationRequest } from "@/core/domain/entities/content";
import type { GenerationReadiness } from "@/core/application/use-cases/generation";
import type { MembrainCategory } from "@/core/domain/entities/membrain";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

function ScoreRow({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium">{label}</p>
        <span className="font-mono text-[12px] text-subtle-foreground">{percent}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", percent >= 80 ? "bg-positive" : percent >= 40 ? "bg-warning" : "bg-danger")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Phase 8 — replaces the Sprint 3.1 recommendation panel. Everything above
 * the "Send brief to Awo" form is read-only diagnostic output from this
 * sprint's engines (Context, Knowledge Resolver, Campaign Resolver, Draft
 * Analyser, Confidence Engine) — nothing here calls a model. The send form
 * itself is Sprint 3's unchanged mechanism for handing a brief to Awo.
 *
 * "Live" updates come from the same place every other panel on this page
 * gets them: a Server Component re-render after an explicit Save, a status
 * change, or a new generation request — not a new polling or websocket
 * layer, which autosave already deliberately avoids for performance (see
 * draft-form.tsx).
 */
export function GenerationReadinessPanel({
  organisationId,
  draftId,
  categories,
  latestRequest,
  readiness,
  canWrite,
}: {
  organisationId: string;
  draftId: string;
  categories: MembrainCategory[];
  latestRequest: ContentGenerationRequest | null;
  readiness: GenerationReadiness;
  canWrite: boolean;
}) {
  const [state, formAction] = useActionState(createGenerationRequestAction, idleState);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (state.status === "success") toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);

  const isReady = readiness.status === "ready_for_awo";

  // Fix D: build structured gap lists from readiness data rather than a flat warnings array.
  const membrainGaps = readiness.knowledgeCoverage.missingCategories;
  const draftGaps = readiness.draftAnalysis.checks.filter((c) => c.applicable && !c.passed);
  const campaignGaps = readiness.campaignReadiness?.checks.filter((c) => !c.met) ?? [];

  const recommendations = [
    ...readiness.knowledgeCoverage.suggestedImprovements,
    ...(readiness.campaignReadiness?.recommendations ?? []),
    ...readiness.draftAnalysis.suggestions,
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Status banner */}
      <div
        className={cn(
          "flex flex-col gap-2 rounded-md border px-3 py-2.5",
          isReady ? "border-positive/30 bg-positive-soft" : "border-warning/30 bg-warning-soft",
        )}
      >
        <div className="flex items-center gap-2">
          {isReady ? (
            <CheckCircle2 className="size-4 shrink-0 text-positive" aria-hidden />
          ) : (
            <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          )}
          <span className={cn("text-[13px] font-medium", isReady ? "text-positive" : "text-warning")}>
            {isReady ? "Ready for Awo" : "Needs attention"}
          </span>
          <span className="ml-auto font-mono text-[12px] text-subtle-foreground">
            {readiness.confidence.score}% confidence
          </span>
        </div>
        {!isReady && readiness.blockingReasons.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {readiness.blockingReasons.map((reason) => (
              <li key={reason} className="text-[12px] text-muted-foreground">
                · {reason}
              </li>
            ))}
          </ul>
        ) : null}
        {/* Fix C: saved-version boundary — readiness is computed from the repository at
            page-load time, not the live editor state. Autosave keeps draft content fresh,
            but an explicit Save (or page reload) is needed to reflect accepted AI
            suggestions or manual edits in these scores. */}
        <p className="text-[11px] text-subtle-foreground">
          Readiness reflects the last saved version of this draft.
        </p>
      </div>

      {/* Score rows */}
      <ScoreRow label="Knowledge coverage" percent={readiness.knowledgeCoverage.coveragePercent} />
      {readiness.campaignReadiness ? (
        <ScoreRow label="Campaign readiness" percent={readiness.campaignReadiness.score} />
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[12px] text-subtle-foreground">
          No campaign linked — campaign readiness isn&apos;t scored.
        </p>
      )}
      <ScoreRow label="Draft readiness" percent={readiness.draftAnalysis.readinessPercent} />
      <ScoreRow label="Overall confidence" percent={readiness.confidence.score} />

      {/* Strengths */}
      {readiness.confidence.strengths.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-subtle-foreground">Strengths</p>
          <div className="flex flex-wrap gap-1.5">
            {readiness.confidence.strengths.map((strength) => (
              <Badge key={strength} tone="positive">
                {strength}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {/* Fix D: MemBrain gaps — show entryCount/requiredCount for partial categories (Fix B). */}
      {membrainGaps.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-subtle-foreground">MemBrain gaps</p>
          <ul className="flex flex-col gap-1">
            {membrainGaps.map((cat) => (
              <li key={cat.categoryKey} className="text-[12px] text-muted-foreground">
                ·{" "}
                {cat.requiredCount > 1
                  ? `${cat.label} — ${cat.entryCount} of ${cat.requiredCount} active entries`
                  : cat.state === "missing"
                    ? `${cat.label} — no active entry`
                    : `${cat.label} — ${cat.state}`}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-subtle-foreground">
            Only Active MemBrain entries count toward readiness. Draft-status entries are excluded.
          </p>
        </div>
      ) : null}

      {/* Fix D: Draft gaps */}
      {draftGaps.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-subtle-foreground">Draft gaps</p>
          <ul className="flex flex-col gap-1">
            {readiness.draftAnalysis.warnings.map((warning) => (
              <li key={warning} className="text-[12px] text-muted-foreground">
                · {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Fix D: Campaign gaps */}
      {campaignGaps.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-subtle-foreground">Campaign gaps</p>
          <ul className="flex flex-col gap-1">
            {(readiness.campaignReadiness?.warnings ?? []).map((warning) => (
              <li key={warning} className="text-[12px] text-muted-foreground">
                · {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recommendations.length > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-subtle-foreground">Recommendations</p>
          <ul className="flex flex-col gap-1">
            {recommendations.map((recommendation) => (
              <li key={recommendation} className="text-[12px] text-muted-foreground">
                · {recommendation}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-[12px]">
        {readiness.promptReady ? (
          <CheckCircle2 className="size-4 shrink-0 text-positive" aria-hidden />
        ) : (
          <Info className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
        )}
        <span className={readiness.promptReady ? "text-positive" : "text-subtle-foreground"}>
          Prompt readiness:{" "}
          {readiness.promptReady
            ? "a structured prompt specification can be assembled."
            : "not enough context yet to assemble a prompt specification."}
        </span>
      </div>

      {latestRequest ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-[12px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="accent">Ready for Awo</Badge>
            <span className="text-subtle-foreground">Requested {formatDateTime(latestRequest.requestedAt)}</span>
          </div>
          <p className="text-muted-foreground">{latestRequest.brief}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="muted">{formatNumber(latestRequest.memBrainEntryCount)} MemBrain entries</Badge>
            <Badge tone="muted">~{formatNumber(latestRequest.memBrainEstimatedTokens)} tokens</Badge>
            <button
              type="button"
              onClick={() => setShowPrompt((v) => !v)}
              className="ml-auto text-primary underline-offset-4 hover:underline"
            >
              {showPrompt ? "Hide" : "Show"} assembled context
            </button>
          </div>
          {showPrompt ? (
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {latestRequest.memBrainContextPrompt}
            </pre>
          ) : null}
        </div>
      ) : null}

      {canWrite ? (
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="organisationId" value={organisationId} />
          <input type="hidden" name="draftId" value={draftId} />

          <Field id="brief" label="Creative brief" errors={state.fieldErrors?.brief} required>
            <Textarea
              id="brief"
              name="brief"
              rows={4}
              maxLength={4000}
              placeholder="What does this piece need to do? e.g. announce the spring promotion to existing patients, warm but not salesy"
              aria-invalid={Boolean(state.fieldErrors?.brief)}
            />
          </Field>

          <Field id="targetAudience" label="Target audience" hint="Optional" errors={state.fieldErrors?.targetAudience}>
            <Input id="targetAudience" name="targetAudience" maxLength={300} />
          </Field>

          <Field id="tone" label="Tone" hint="Optional" errors={state.fieldErrors?.tone}>
            <Input id="tone" name="tone" maxLength={100} placeholder="Warm, direct, no jargon" />
          </Field>

          <Field
            id="contentPillarCategoryId"
            label="Content pillar"
            hint="Optional"
            errors={state.fieldErrors?.contentPillarCategoryId}
          >
            <Select id="contentPillarCategoryId" name="contentPillarCategoryId" defaultValue="">
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </Select>
          </Field>

          <FormMessage state={state} />

          <SubmitButton pendingLabel="Assembling…">
            <Sparkles aria-hidden />
            {latestRequest ? "Send updated request to Awo" : "Send brief to Awo"}
          </SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

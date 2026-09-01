import { z } from "zod";
import { createAdminClient } from "../src/infrastructure/supabase/admin-client";
import { SupabaseOrganisationRepository } from "../src/infrastructure/repositories/supabase-organisation-repository";
import { SupabaseMembrainRepository } from "../src/infrastructure/repositories/supabase-membrain-repository";
import { SupabaseContentRepository } from "../src/infrastructure/repositories/supabase-content-repository";
import { SupabaseCampaignRepository } from "../src/infrastructure/repositories/supabase-campaign-repository";
import { getAIProvider } from "../src/infrastructure/ai/provider-factory";
import { getCampaignSchedule } from "../src/server/queries/campaign-schedule";
import { getDraft, getLatestGenerationRequest, updateDraft } from "../src/core/application/use-cases/content";
import type { Actor } from "../src/core/domain/entities/identity";
import { validateDistributionOutput } from "./awo-distribution-validator";
import { distributionProfilePrompt, resolveCampaignDistributionProfile, type CampaignDistributionProfile } from "./awo-campaign-distribution-profile";

const POLL_INTERVAL_MS = Number(process.env.AWO_WORKER_POLL_INTERVAL_MS ?? 2000);
const STALE_RECOVERY_INTERVAL_MS = Number(process.env.AWO_WORKER_STALE_RECOVERY_INTERVAL_MS ?? 60000);
const STALE_AFTER_SECONDS = Number(process.env.AWO_WORKER_STALE_AFTER_SECONDS ?? 900);
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.AWO_WORKER_CONCURRENCY ?? 3), 6));
const MAX_VALIDATION_ATTEMPTS = Math.max(1, Math.min(Number(process.env.AWO_DISTRIBUTION_VALIDATION_ATTEMPTS ?? 3), 5));
const MAX_PROVIDER_ATTEMPTS = Math.max(1, Math.min(Number(process.env.AWO_PROVIDER_RETRY_ATTEMPTS ?? 4), 6));
const PROVIDER_RETRY_BASE_MS = Math.max(250, Math.min(Number(process.env.AWO_PROVIDER_RETRY_BASE_MS ?? 1500), 15000));
const WORKER_ID = `awo-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const generatedSocialPostSchema = z.object({
  caption: z.string().min(20).max(2200),
  hashtags: z.array(z.string().min(2).max(80)).min(5).max(20),
  hook: z.string().min(4).max(240),
  cta: z.string().min(2).max(240),
});

type Job = {
  id: string;
  organisation_id: string;
  campaign_id: string;
  requested_by: string;
  status: string;
  mode?: "unfinished" | "distribution_reoptimise";
  total_posts: number;
  completed_posts: number;
  failed_posts: number;
};
type RpcResult<T> = { data: T; error: { message: string } | null };
type JobDb = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult<unknown>>; from: (table: "awo_campaign_jobs") => { update: (values: Record<string, unknown>) => { eq: (column: "id", value: string) => PromiseLike<{ error: { message: string } | null }>; }; }; };
let shuttingDown = false;

export function logAwo(event: string, fields: Record<string, unknown> = {}) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), workerId: WORKER_ID, subsystem: "awo_campaign", event, ...fields })); }
function workerActor(requestedBy: string): Actor { return { id: requestedBy, email: "awo-worker@villiz.internal", fullName: "Awo Background Worker", avatarUrl: null, jobTitle: "Campaign intelligence automation", role: "admin", isActive: true, createdAt: new Date(0).toISOString(), isPlatformAdmin: true }; }
function buildContentDeps(client: ReturnType<typeof createAdminClient>, requestedBy: string) { const actor = workerActor(requestedBy); return { actor, content: new SupabaseContentRepository(client), membrain: new SupabaseMembrainRepository(client), organisations: new SupabaseOrganisationRepository(client, actor.id), campaigns: new SupabaseCampaignRepository(client) }; }
async function setJob(db: JobDb, id: string, values: Record<string, unknown>) { const { error } = await db.from("awo_campaign_jobs").update(values).eq("id", id); if (error) throw new Error(`Could not update Awo job ${id}: ${error.message}`); }
async function claimNext(db: JobDb): Promise<Job | null> { const result = await db.rpc("claim_next_awo_campaign_job", { p_worker_id: WORKER_ID }); if (result.error) throw new Error(result.error.message); const rows = Array.isArray(result.data) ? result.data as Job[] : []; return rows[0] ?? null; }
async function recoverStale(db: JobDb) { const result = await db.rpc("recover_stale_awo_campaign_jobs", { p_stale_seconds: STALE_AFTER_SECONDS }); if (result.error) throw new Error(result.error.message); const count = typeof result.data === "number" ? result.data : 0; if (count > 0) logAwo("stale_jobs_recovered", { count }); }
function platformInstruction(platform: string): string { if (platform === "tiktok") return "TikTok: lead with a searchable natural-language hook; use terms a local customer would type into search; favour relevance and specificity over hashtag volume."; if (platform === "instagram") return "Instagram: strong opening line, skimmable caption, searchable service/location language and a deliberate discovery hashtag mix."; return `Write specifically for ${platform}, using its native search and discovery behaviour.`; }
function sleep(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

export function shouldInvalidateReoptimisationOutput(force: boolean, body: string, hashtags: string[]): boolean {
  return force && Boolean(body.trim() || hashtags.length);
}

export function isRetryableProviderError(error: unknown): boolean {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).toLowerCase();
  return [
    "high demand",
    "temporarily",
    "try again later",
    "rate limit",
    "429",
    "503",
    "502",
    "504",
    "timeout",
    "timed out",
    "no object generated",
    "response did not match schema",
    "ai_apicallerror",
  ].some((token) => message.includes(token));
}

export function providerRetryDelayMs(attempt: number, baseMs = PROVIDER_RETRY_BASE_MS): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(baseMs * (2 ** exponent), 30000);
}

const distributionInstruction = `DISTRIBUTION INTELLIGENCE GATE — mandatory:
Build discovery deliberately; never treat hashtags as decoration. Infer ONLY from supplied Brand/MemBrain/brief evidence.
1. Brand: include the verified brand name or branded discovery term where appropriate.
2. Service intent: include specific terms describing the actual service/topic and customer search intent.
3. Audience intent: reflect the supplied target audience and the problem, desire or occasion driving discovery.
4. Locality: obey the shared Campaign Distribution Profile. If locality is required, every post must include at least one verified locality signal. If locality is not resolved, NEVER invent one.
5. Platform search: make the caption itself searchable with natural-language keywords; hashtags supplement the caption rather than substitute for it.
6. Hashtag portfolio: return 5–20 unique, genuinely relevant hashtags spanning brand, service/niche, audience/intent and verified locality when required. Use only ASCII letters, digits and underscores in hashtag tokens. Avoid generic high-volume stuffing (#viral, #fyp, #explorepage, #trending) unless the campaign brief explicitly requires one and it is strategically justified.
7. Conversion: CTA must match the campaign objective and must not invent an offer, price, booking method or availability.
8. Quality gate: before returning, silently reject and rewrite any output whose discovery terms could fit almost any business, whose locality conflicts with the Campaign Distribution Profile, whose hashtag token contains unexpected scripts/symbols, or whose hashtags are mostly generic.
The goal is qualified discoverability and conversion probability, not vanity reach. Do not claim or imply guaranteed reach, ranking or algorithmic distribution.`;

async function optimiseSlot(job: Job, slot: Awaited<ReturnType<typeof getCampaignSchedule>>[number], deps: ReturnType<typeof buildContentDeps>, campaignName: string, force: boolean, profile: CampaignDistributionProfile) {
  if (!slot.draftId) return { skipped: true, error: null as string | null };
  try {
    const draft = await getDraft(deps, job.organisation_id, slot.draftId);
    if (!force && draft.body.trim() && draft.hashtags.length) return { skipped: true, error: null as string | null };

    if (shouldInvalidateReoptimisationOutput(force, draft.body, draft.hashtags)) {
      await updateDraft(deps, {
        organisationId: job.organisation_id,
        id: draft.id,
        title: draft.title,
        contentType: draft.contentType,
        categoryId: draft.category?.id ?? "",
        campaignId: job.campaign_id,
        summary: draft.summary ?? "",
        body: "",
        dueAt: draft.dueAt ?? "",
        reviewerIds: draft.reviewerIds,
        priority: draft.priority,
        reviewDeadline: draft.reviewDeadline ?? "",
        hashtags: [],
        changeSummary: `Awo re-optimisation invalidated stale Week ${slot.weekNumber} ${slot.platform} output before fresh generation.`,
      });
      logAwo("reoptimisation_stale_output_invalidated", { jobId: job.id, draftId: draft.id, weekNumber: slot.weekNumber, platform: slot.platform });
    }

    const request = await getLatestGenerationRequest(deps, job.organisation_id, draft.id);
    if (!request) throw new Error("No Awo generation request exists for this draft.");
    const basePrompt = [`You are Awo, the campaign intelligence writer for ${campaignName}.`, `Week ${slot.weekNumber}. Platform: ${slot.platform}.`, platformInstruction(slot.platform), distributionInstruction, distributionProfilePrompt(profile), request.brief, request.targetAudience ? `Target audience: ${request.targetAudience}.` : "", request.tone ? `Tone: ${request.tone}.` : "", `Brand and MemBrain context:\n${request.memBrainContextPrompt}`, force ? "This is an explicit Distribution Intelligence v2 re-optimisation. Generate a completely fresh replacement; do not reuse or preserve prior generated copy." : "", "Return a platform-ready caption, unique hashtags, a hook and CTA. Every discovery choice must be traceable to supplied campaign, MemBrain or the shared Campaign Distribution Profile. Avoid fabricated claims."].filter(Boolean).join("\n\n");
    const ai = getAIProvider();
    let validationErrors: string[] = [];

    for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt += 1) {
      const repairPrompt = validationErrors.length
        ? `${basePrompt}\n\nYour previous output failed deterministic validation for these reasons:\n- ${validationErrors.join("\n- ")}\nRegenerate from scratch and correct every failure. The Campaign Distribution Profile is authoritative.`
        : basePrompt;

      let generated: z.infer<typeof generatedSocialPostSchema> | null = null;
      let lastProviderError: unknown = null;
      for (let providerAttempt = 1; providerAttempt <= MAX_PROVIDER_ATTEMPTS; providerAttempt += 1) {
        try {
          const schemaReminder = providerAttempt > 1
            ? "\n\nSTRUCTURED OUTPUT RECOVERY: Return exactly the requested object fields: caption (string), hashtags (array of strings), hook (string), cta (string). Do not wrap the object in prose or markdown."
            : "";
          generated = await ai.generateObject(`${repairPrompt}${schemaReminder}`, generatedSocialPostSchema, {
            systemPrompt: "Create evidence-grounded, search-aware social content. Apply the distribution intelligence gate and shared Campaign Distribution Profile. Follow supplied brand context and campaign objective. Never invent offers, prices, locations, testimonials, credentials, facts, or guarantees of algorithmic reach. Hashtag tokens must contain only ASCII letters, digits and underscores.",
            temperature: attempt === 1 ? 0.45 : 0.25,
          });
          if (providerAttempt > 1) logAwo("provider_retry_recovered", { jobId: job.id, draftId: draft.id, weekNumber: slot.weekNumber, platform: slot.platform, providerAttempt });
          break;
        } catch (providerError) {
          lastProviderError = providerError;
          const retryable = isRetryableProviderError(providerError);
          logAwo("provider_generation_error", { jobId: job.id, draftId: draft.id, weekNumber: slot.weekNumber, platform: slot.platform, validationAttempt: attempt, providerAttempt, retryable, error: providerError instanceof Error ? providerError.message : String(providerError) });
          if (!retryable || providerAttempt >= MAX_PROVIDER_ATTEMPTS) throw providerError;
          const delayMs = providerRetryDelayMs(providerAttempt);
          logAwo("provider_retry_scheduled", { jobId: job.id, draftId: draft.id, weekNumber: slot.weekNumber, platform: slot.platform, providerAttempt, delayMs });
          await sleep(delayMs);
        }
      }
      if (!generated) throw lastProviderError instanceof Error ? lastProviderError : new Error("Provider failed to generate structured campaign content.");

      const validation = validateDistributionOutput(generated, {
        campaignName,
        brief: request.brief,
        targetAudience: request.targetAudience ?? "",
        evidenceText: request.memBrainContextPrompt,
        profile,
      });
      if (!validation.ok) {
        validationErrors = validation.errors;
        logAwo("distribution_validation_rejected", { jobId: job.id, draftId: draft.id, weekNumber: slot.weekNumber, platform: slot.platform, attempt, portfolioScore: validation.portfolioScore, localityRequired: profile.localityRequired, errors: validation.errors });
        continue;
      }

      const body = `${generated.hook}\n\n${generated.caption}\n\n${generated.cta}`.trim();
      await updateDraft(deps, { organisationId: job.organisation_id, id: draft.id, title: draft.title, contentType: draft.contentType, categoryId: draft.category?.id ?? "", campaignId: job.campaign_id, summary: draft.summary ?? "", body, dueAt: draft.dueAt ?? "", reviewerIds: draft.reviewerIds, priority: draft.priority, reviewDeadline: draft.reviewDeadline ?? "", hashtags: validation.hashtags, changeSummary: `${force ? "Awo Distribution Intelligence v2 re-optimised" : "Awo distribution-intelligence optimised"} Week ${slot.weekNumber} for ${slot.platform}; Campaign Distribution Profile enforced; discovery portfolio ${validation.portfolioScore}/100.` });
      await deps.content.updateStatus(job.organisation_id, draft.id, "needs_review", job.requested_by);
      logAwo("distribution_validation_passed", { jobId: job.id, draftId: draft.id, weekNumber: slot.weekNumber, platform: slot.platform, attempt, portfolioScore: validation.portfolioScore, localityRequired: profile.localityRequired });
      if (attempt > 1) logAwo("distribution_validation_recovered", { jobId: job.id, draftId: draft.id, weekNumber: slot.weekNumber, platform: slot.platform, attempt });
      return { skipped: false, error: null as string | null };
    }

    throw new Error(`Distribution output failed validation after ${MAX_VALIDATION_ATTEMPTS} attempts: ${validationErrors.join("; ")}`);
  } catch (error) {
    if (force && slot.draftId) {
      try {
        await deps.content.updateStatus(job.organisation_id, slot.draftId, "failed", job.requested_by);
      } catch (statusError) {
        logAwo("reoptimisation_failed_status_update", { jobId: job.id, draftId: slot.draftId, weekNumber: slot.weekNumber, platform: slot.platform, error: statusError instanceof Error ? statusError.message : String(statusError) });
      }
    }
    return { skipped: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function processJob(job: Job, client: ReturnType<typeof createAdminClient>, db: JobDb) {
  const started = Date.now();
  const deps = buildContentDeps(client, job.requested_by);
  const campaign = await deps.campaigns.findCampaign(job.organisation_id, job.campaign_id);
  if (!campaign) { await setJob(db, job.id, { status: "failed", last_error: "Campaign not found.", finished_at: new Date().toISOString() }); return; }
  const schedule = (await getCampaignSchedule(job.campaign_id)).filter((slot) => slot.draftId);
  if (!schedule.length) { await setJob(db, job.id, { status: "failed", last_error: "Campaign schedule has no drafts.", finished_at: new Date().toISOString() }); return; }

  const currentDrafts = await Promise.all(schedule.map((slot) => deps.content.findDraft(job.organisation_id, slot.draftId!)));
  const generationRequests = await Promise.all(currentDrafts.map((draft) => draft ? getLatestGenerationRequest(deps, job.organisation_id, draft.id) : Promise.resolve(null)));
  const profile = resolveCampaignDistributionProfile(campaign.name, generationRequests.filter((request): request is NonNullable<typeof request> => Boolean(request)).map((request) => ({ brief: request.brief, targetAudience: request.targetAudience, memBrainContextPrompt: request.memBrainContextPrompt })));
  logAwo("campaign_distribution_profile_resolved", { jobId: job.id, campaignId: job.campaign_id, localityRequired: profile.localityRequired, localityTokens: profile.localityTokens, brandTokens: profile.brandTokens, serviceTokenCount: profile.serviceTokens.length, audienceTokenCount: profile.audienceTokens.length });

  const force = job.mode === "distribution_reoptimise";
  let completed = force ? 0 : currentDrafts.filter((draft) => draft && draft.body.trim() && draft.hashtags.length).length;
  let failed = 0;
  const failures: string[] = [];
  await setJob(db, job.id, { total_posts: schedule.length, completed_posts: completed, failed_posts: 0, locked_at: new Date().toISOString() });
  logAwo("job_started", { jobId: job.id, campaignId: job.campaign_id, mode: job.mode ?? "unfinished", total: schedule.length, alreadyCompleted: completed, concurrency: CONCURRENCY, validationAttempts: MAX_VALIDATION_ATTEMPTS, providerAttempts: MAX_PROVIDER_ATTEMPTS, localityRequired: profile.localityRequired });

  const pending = force ? schedule : schedule.filter((slot, index) => { const draft = currentDrafts[index]; return !(draft && draft.body.trim() && draft.hashtags.length); });
  for (let offset = 0; offset < pending.length && !shuttingDown; offset += CONCURRENCY) {
    const chunk = pending.slice(offset, offset + CONCURRENCY);
    const results = await Promise.all(chunk.map((slot) => optimiseSlot(job, slot, deps, campaign.name, force, profile)));
    results.forEach((result, index) => {
      if (result.error) { failed += 1; const slot = chunk[index]; failures.push(`Week ${slot?.weekNumber ?? "?"} ${slot?.platform ?? "?"}: ${result.error}`); }
      else if (!result.skipped) completed += 1;
    });
    await setJob(db, job.id, { completed_posts: completed, failed_posts: failed, last_error: failures.length ? failures.slice(-3).join(" | ") : null, locked_at: new Date().toISOString() });
    logAwo("job_progress", { jobId: job.id, mode: job.mode ?? "unfinished", completed, failed, total: schedule.length });
  }

  let finalCompleted = completed;
  if (!force) {
    const finalDrafts = await Promise.all(schedule.map((slot) => deps.content.findDraft(job.organisation_id, slot.draftId!)));
    finalCompleted = finalDrafts.filter((draft) => draft && draft.body.trim() && draft.hashtags.length).length;
  }
  const finalStatus = finalCompleted >= schedule.length && failed === 0 ? "completed" : "failed";
  await setJob(db, job.id, { status: finalStatus, completed_posts: finalCompleted, failed_posts: Math.max(failed, schedule.length - finalCompleted), last_error: finalStatus === "completed" ? null : failures.slice(-5).join(" | ") || "Some posts remain unfinished.", finished_at: new Date().toISOString(), locked_at: null });
  logAwo("job_finished", { jobId: job.id, mode: job.mode ?? "unfinished", status: finalStatus, completed: finalCompleted, total: schedule.length, durationMs: Date.now() - started });
}

export async function runAwoCampaignWorker() { const client = createAdminClient(); const db = client as unknown as JobDb; let lastRecovery = 0; logAwo("worker_started", { pollIntervalMs: POLL_INTERVAL_MS, concurrency: CONCURRENCY, providerAttempts: MAX_PROVIDER_ATTEMPTS }); const stop = () => { shuttingDown = true; }; process.once("SIGTERM", stop); process.once("SIGINT", stop); while (!shuttingDown) { try { if (Date.now() - lastRecovery >= STALE_RECOVERY_INTERVAL_MS) { await recoverStale(db); lastRecovery = Date.now(); } const job = await claimNext(db); if (!job) { await sleep(POLL_INTERVAL_MS); continue; } await processJob(job, client, db); } catch (error) { logAwo("worker_error", { error: error instanceof Error ? error.message : String(error) }); await sleep(Math.max(POLL_INTERVAL_MS, 5000)); } } logAwo("worker_stopped"); }

import { createAdminClient } from "../src/infrastructure/supabase/admin-client";
import { SupabasePublishingRepository } from "../src/infrastructure/repositories/supabase-publishing-repository";
import { SupabaseBlotatoAccountRepository } from "../src/infrastructure/repositories/supabase-blotato-account-repository";
import { SupabaseContentRepository } from "../src/infrastructure/repositories/supabase-content-repository";
import { SupabaseMediaRepository } from "../src/infrastructure/repositories/supabase-media-repository";
import { HttpBlotatoClient } from "../src/infrastructure/blotato/http-blotato-client";
import { blotatoConfig } from "../src/infrastructure/blotato/blotato-config";
import { startPublishingAttempt } from "../src/core/application/use-cases/publishing";
import type { PublishingJob } from "../src/core/domain/entities/publishing";
import { resolvePublisher } from "../src/infrastructure/publishers/publisher-factory";
import { composePublishedText } from "../src/core/application/use-cases/content/hashtags";

const admin = createAdminClient();
const cfg = blotatoConfig();
console.log('blotato cfg:', { enabled: cfg.enabled, live: cfg.livePublishingEnabled, hasKey: !!cfg.apiKey });

const JOB_ID = process.env.THE_JOB_ID!;
const ORG_ID = '90ff2de8-4268-4185-adfe-1d930b146d7f';
const WORKER = 'worker-awo-debug-1';

const publishing = new SupabasePublishingRepository(admin);
const content = new SupabaseContentRepository(admin);
const mediaRepo = new SupabaseMediaRepository(admin);

// claim THIS job by direct row fetch (it's queued right now)
const jobRow = await publishing.findJobById(ORG_ID, JOB_ID);
if (!jobRow) { console.log('no job'); process.exit(1); }
console.log('job status', jobRow.status, jobRow.executionMode);

const job = jobRow;
const attempt = await startPublishingAttempt({ publishing, content }, job as PublishingJob);
console.log('attempt started', attempt.id, 'n', attempt.attemptNumber);

const draft = await content.findDraft(ORG_ID, job.draftId);
console.log('draft', draft?.status, 'body', draft?.body.length, 'tags', draft?.hashtags?.length);
const { SupabaseStoragePort } = await import("../src/infrastructure/ports/supabase-storage-port");
const storage = new SupabaseStoragePort((admin as any));
const { resolvePublishMediaUrls } = await import("../src/core/application/use-cases/publishing/media");
const media = await resolvePublishMediaUrls({ media: mediaRepo, storage } as any, { organisationId: ORG_ID, draftId: job.draftId });
console.log('media urls', media.mediaUrls.length, (media as any).mimeTypes, 'skipped', JSON.stringify(media.skipped));

const blotatoAccounts = new SupabaseBlotatoAccountRepository(admin);
const publisher = resolvePublisher(job.platform, {
  blotatoAccounts,
  blotatoClient: new HttpBlotatoClient(cfg.apiKey),
  livePublishingEnabled: true,
  assetMimeTypes: media.mimeTypes,
  onBeforePublish: (p) => console.log('dry-run preview:', JSON.stringify(p).slice(0, 300)),
});
console.log('publisher:', publisher.constructor.name);

const result = await publisher.publish({
  organisationId: ORG_ID,
  draftId: job.draftId,
  jobId: job.id,
  attemptId: attempt.id,
  attemptNumber: attempt.attemptNumber,
  platform: job.platform,
  title: draft!.title,
  body: composePublishedText(draft!.body, draft!.hashtags ?? []),
  assetUrls: media.mediaUrls,
  devSimulationMode: null,
  resolvedAccountId: job.resolvedAccountId,
  isAiGenerated: job.isAiGenerated,
  isYourBrand: job.isYourBrand,
  isBrandedContent: job.isBrandedContent,
  onBeforeSubmission: async () => { /* debug: skip barrier to isolate the error */ },
});
console.log('PUBLISH RESULT:', JSON.stringify(result).slice(0, 600));
process.exit(0);
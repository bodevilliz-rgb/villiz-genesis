-- TikTok commercial-content disclosure (pre-merge compliance correction on
-- feature/tiktok-publishing, following the AI-disclosure correction in
-- 20260810000000_publishing_jobs_ai_disclosure.sql).
--
-- WHY A MIGRATION IS REQUIRED: TikTok's Content Posting API guidelines
-- (developers.tiktok.com/doc/content-sharing-guidelines) require the
-- posting client to let the operator disclose, per post, whether the
-- content promotes their own brand/business (isYourBrand) and/or a
-- third-party brand under a paid partnership (isBrandedContent) — two
-- independent truth claims, not a single flag, and not derivable from
-- isAiGenerated. Same reasoning as the prior migration applies verbatim:
-- this is a per-post declaration only the operator can make, captured once
-- at job creation, and must survive to worker execution (immediate,
-- scheduled, retried) — so it needs the same durable, non-defaulted home on
-- publishing_jobs.
--
-- NULL semantics: "never declared" for each field independently. Only
-- platforms whose canonical policy sets requiresCommercialDisclosure
-- (TikTok alone) ever have these enforced non-null by deterministic
-- preflight. Deliberately no DEFAULT clause on either column — a database
-- default would silently fabricate a "no commercial content" declaration
-- the operator never made, exactly the defect this correction removes.
alter table public.publishing_jobs
  add column if not exists is_your_brand boolean,
  add column if not exists is_branded_content boolean;

comment on column public.publishing_jobs.is_your_brand is
  'Operator''s explicit per-post declaration that content promotes their own brand/business (TikTok commercial-content disclosure). NULL = never declared; enforced (non-null required for live publishing) only for platforms whose canonical policy requires commercial disclosure (TikTok). Never defaulted or inferred.';

comment on column public.publishing_jobs.is_branded_content is
  'Operator''s explicit per-post declaration that content promotes a third-party brand under a paid partnership (TikTok commercial-content disclosure). Independent of is_your_brand — both may be true. NULL = never declared. Never defaulted or inferred.';

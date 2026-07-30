import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createGenesisClient, type GenesisClient } from "@/infrastructure/supabase/server-client";
import { SupabaseIdentityGateway } from "@/infrastructure/repositories/supabase-identity-gateway";
import { SupabaseOrganisationRepository } from "@/infrastructure/repositories/supabase-organisation-repository";
import { SupabaseMembrainRepository } from "@/infrastructure/repositories/supabase-membrain-repository";
import { SupabaseContentRepository } from "@/infrastructure/repositories/supabase-content-repository";
import { SupabaseCampaignRepository } from "@/infrastructure/repositories/supabase-campaign-repository";
import { SupabaseReviewRepository } from "@/infrastructure/repositories/supabase-review-repository";
import { SupabaseUsageRepository } from "@/infrastructure/repositories/supabase-usage-repository";
import type { Actor } from "@/core/domain/entities/identity";
import { routes } from "@/lib/routes";

/**
 * Composition root.
 *
 * This is the single place where the application layer is wired to Supabase.
 * Nothing above it imports an adapter directly, which is what keeps the core
 * portable and the use cases unit-testable with fakes.
 *
 * `cache()` deduplicates the actor lookup across a render pass, so a page that
 * checks permissions in five components still performs one auth round trip.
 */
export interface RequestContext {
  actor: Actor;
  client: GenesisClient;
  identity: SupabaseIdentityGateway;
  organisations: SupabaseOrganisationRepository;
  membrain: SupabaseMembrainRepository;
  content: SupabaseContentRepository;
  campaigns: SupabaseCampaignRepository;
  reviews: SupabaseReviewRepository;
  usage: SupabaseUsageRepository;
}

export const getActor = cache(async (): Promise<Actor | null> => {
  const client = await createGenesisClient();
  return new SupabaseIdentityGateway(client).getActor();
});

export const getRequestContext = cache(async (): Promise<RequestContext | null> => {
  const client = await createGenesisClient();
  const identity = new SupabaseIdentityGateway(client);
  const actor = await identity.getActor();
  if (!actor || !actor.isActive) return null;

  return {
    actor,
    client,
    identity,
    organisations: new SupabaseOrganisationRepository(client, actor.id),
    membrain: new SupabaseMembrainRepository(client),
    content: new SupabaseContentRepository(client),
    campaigns: new SupabaseCampaignRepository(client),
    reviews: new SupabaseReviewRepository(client),
    usage: new SupabaseUsageRepository(client),
  };
});

/** Use in every authenticated page, layout and action. Redirects rather than throwing. */
export async function requireContext(): Promise<RequestContext> {
  const context = await getRequestContext();
  if (!context) redirect(routes.login);
  return context;
}

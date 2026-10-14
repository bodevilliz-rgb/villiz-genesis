import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { PickQueueCard, type PickQueueCardModel } from "@/components/publishing/pick-queue-card";
import { buildPickCaptionOptions } from "@/core/application/use-cases/picks-queue";
import { retrieveContext } from "@/core/application/use-cases/membrain";
import type { PicksQueueItemRow } from "@/infrastructure/supabase/database.types";
import { requireContext } from "@/server/container";
import { Sparkles } from "lucide-react";

export const metadata: Metadata = { title: "Picks Queue" };
export const dynamic = "force-dynamic";

function storedOptions(value: PicksQueueItemRow["caption_options"]): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function driveThumbnail(sourceRef: string): string | null {
  const id = sourceRef.replace(/^drive:/, "").trim();
  return id ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w640` : null;
}

export default async function PicksQueuePage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const context = await requireContext();
  const organisation = await context.organisations.findById(orgId);
  if (!organisation) notFound();

  const [{ data, error }, pack] = await Promise.all([
    context.client
      .from("picks_queue_items")
      .select()
      .eq("organisation_id", orgId)
      .order("created_at", { ascending: false })
      .limit(100),
    retrieveContext(
      { actor: context.actor, membrain: context.membrain, organisations: context.organisations },
      { organisationId: orgId, query: "social post caption brand voice audience", limit: 12, maxCharacters: 24000, recordUsage: false },
    ),
  ]);
  if (error) throw new Error(`Picks Queue could not be loaded: ${error.message}`);

  const cards: PickQueueCardModel[] = await Promise.all(((data ?? []) as PicksQueueItemRow[]).map(async (row) => {
    const generated = buildPickCaptionOptions({ itemLabel: row.item_label, context: pack.items });
    const persisted = storedOptions(row.caption_options);
    const options = persisted.length === 3 ? persisted as [string, string, string] : generated;
    let thumbnailUrl: string | null = null;
    if (row.asset_id) {
      const asset = await context.media.getAsset(orgId, row.asset_id);
      if (asset) {
        try { thumbnailUrl = await context.storage.getSignedUrl(asset.thumbnailPath ?? asset.storagePath); }
        catch { thumbnailUrl = null; }
      }
    } else if (row.source_kind === "drive_reference") {
      thumbnailUrl = driveThumbnail(row.source_ref);
    }
    return {
      id: row.id,
      itemLabel: row.item_label,
      thumbnailUrl,
      sourceLabel: row.source_kind === "drive_reference" ? "Drive reference" : "organisation-media",
      captionOptions: options,
      platform: row.platform,
      slotTime: row.slot_time,
      status: row.status,
      publicUrl: row.public_url,
      canPublish: row.asset_id !== null && row.status !== "published" && row.status !== "verified",
    };
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Owner approval"
        title="Picks Queue"
        description="Choose one caption, then GO now, GO at a UTC slot, or verify a post you published natively. Genesis records the receipt only after provider readback."
      />
      {cards.length === 0 ? (
        <EmptyState icon={<Sparkles />} title="No staged picks" description="Stage an asset or import a weekly pack. Picks come from Genesis staging tables, never scan_state.json at runtime." />
      ) : (
        <div className="space-y-4">
          {cards.map((pick) => <PickQueueCard key={pick.id} organisationId={orgId} pick={pick} />)}
        </div>
      )}
    </div>
  );
}

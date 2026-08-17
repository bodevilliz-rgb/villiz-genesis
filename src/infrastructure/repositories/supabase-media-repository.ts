/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import type { MediaRepository, MediaAssetWriteModel, MediaLibraryPageFilters } from "../../core/application/ports/media-port";
import type { MediaAsset, MediaCollection, MediaAssetVersion, MediaAssetListItem, PaginatedMediaAssets, MediaLibraryStats, MediaDeletionBlockCode, MediaDeletionResult, MediaDeletionStatus } from "../../core/domain/entities/media";
import type { BrandKit } from "../../core/domain/entities/brand";

export class SupabaseMediaRepository implements MediaRepository {
  private client: any;
  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async createAsset(organisationId: string, storagePath: string, fileName: string, mimeType: string, sizeBytes: number, uploadedBy: string): Promise<MediaAsset> {
    const result = await this.client
      .from("media_assets")
      .insert({
        organisation_id: organisationId,
        storage_path: storagePath,
        file_name: fileName,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        uploaded_by: uploadedBy,
      } as any)
      .select()
      .single();

    if (result.error) throw result.error;
    return this.mapToDomain(result.data);
  }

  async updateAssetMetadata(assetId: string, input: MediaAssetWriteModel): Promise<MediaAsset> {
    const result = await this.client
      .from("media_assets")
      .update({
        title: input.title,
        thumbnail_path: input.thumbnailPath,
        category: input.category,
        description: input.description,
        alt_text: input.altText,
        tags: input.tags,
        brand: input.brand,
        duration: input.duration,
        copyright_owner: input.copyrightOwner,
        usage_rights: input.usageRights,
        expires_at: input.expiresAt,
        is_ai_generated: input.isAiGenerated,
        is_archived: input.isArchived,
      } as any)
      .eq("id", assetId)
      .select()
      .single();

    if (result.error) throw result.error;
    return this.mapToDomain(result.data);
  }

  async getAsset(organisationId: string, assetId: string): Promise<MediaAsset | null> {
    const result = await this.client
      .from("media_assets")
      .select()
      .eq("id", assetId)
      .eq("organisation_id", organisationId)
      .maybeSingle();

    if (result.error) throw result.error;
    if (!result.data) return null;
    return this.mapToDomain(result.data);
  }

  async listAssets(organisationId: string, options?: { category?: string; isArchived?: boolean; typePrefix?: string }): Promise<MediaAsset[]> {
    let query = this.client
      .from("media_assets")
      .select()
      .eq("organisation_id", organisationId);

    if (options?.category) {
      query = query.eq("category" as any, options.category);
    }
    if (options?.isArchived !== undefined) {
      query = query.eq("is_archived", options.isArchived);
    }
    if (options?.typePrefix) {
      query = query.like("mime_type", `${options.typePrefix}%`);
    }

    query = query.order("created_at", { ascending: false });

    const result = await query;
    if (result.error) throw result.error;

    return result.data.map((row: any) => this.mapToDomain(row));
  }

  /**
   * Server-side pagination for the Media Library grid — selects only the
   * columns the grid renders (see MediaAssetListItem), filters and ranges
   * in Postgres via .range()/.or()/.like(), and never fetches more than one
   * page of rows regardless of how large the organisation's library is.
   */
  async listAssetsPage(organisationId: string, filters: MediaLibraryPageFilters): Promise<PaginatedMediaAssets> {
    let query = this.client
      .from("media_assets")
      .select(
        "id, organisation_id, title, file_name, mime_type, size_bytes, storage_path, tags, alt_text, is_archived, is_ai_generated, created_at",
        { count: "exact" },
      )
      .eq("organisation_id", organisationId);

    if (filters.isArchived !== undefined) {
      query = query.eq("is_archived", filters.isArchived);
    }

    if (filters.mimeFilter) {
      if (filters.mimeFilter === "document") {
        query = query.or("mime_type.ilike.%pdf%,mime_type.ilike.%document%");
      } else {
        query = query.like("mime_type", `${filters.mimeFilter}/%`);
      }
    }

    if (filters.search) {
      const term = `%${filters.search}%`;
      query = query.or(`file_name.ilike.${term},title.ilike.${term}`);
    }

    query = query
      .order("created_at", { ascending: false })
      .range(filters.offset, filters.offset + filters.limit - 1);

    const result = await query;
    if (result.error) throw result.error;

    const items = (result.data ?? []).map((row: any) => this.mapToListItem(row));
    const total = result.count ?? items.length;
    return { items, total, hasMore: filters.offset + items.length < total };
  }

  /**
   * Four bounded aggregate queries (count/count/count/skinny-column-sum) —
   * never fetches full asset rows. The size-bytes sum is the only one that
   * scans every row, but only that single narrow column, unlike the former
   * page.tsx which fetched every column of every asset just to sum one field.
   */
  async getLibraryStats(organisationId: string): Promise<MediaLibraryStats> {
    const [totalRes, imageRes, videoRes, sizesRes] = await Promise.all([
      this.client.from("media_assets").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId),
      this.client.from("media_assets").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).like("mime_type", "image/%"),
      this.client.from("media_assets").select("id", { count: "exact", head: true }).eq("organisation_id", organisationId).like("mime_type", "video/%"),
      this.client.from("media_assets").select("size_bytes").eq("organisation_id", organisationId),
    ]);

    if (totalRes.error) throw totalRes.error;
    if (imageRes.error) throw imageRes.error;
    if (videoRes.error) throw videoRes.error;
    if (sizesRes.error) throw sizesRes.error;

    const totalStorageBytes = (sizesRes.data ?? []).reduce((sum: number, row: any) => sum + (row.size_bytes ?? 0), 0);

    return {
      totalAssets: totalRes.count ?? 0,
      imageCount: imageRes.count ?? 0,
      videoCount: videoRes.count ?? 0,
      totalStorageBytes,
    };
  }

  private mapToListItem(row: any): MediaAssetListItem {
    return {
      id: row.id,
      organisationId: row.organisation_id,
      title: row.title ?? null,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      storagePath: row.storage_path,
      tags: row.tags ?? [],
      altText: row.alt_text ?? null,
      isArchived: row.is_archived ?? false,
      isAiGenerated: row.is_ai_generated ?? false,
      createdAt: row.created_at,
    };
  }

  async replaceAssetVersion(assetId: string, storagePath: string, fileName: string, mimeType: string, sizeBytes: number, replacedBy: string): Promise<MediaAsset> {
    // 1. Fetch current asset
    const current = await this.client.from("media_assets").select().eq("id", assetId).single();
    if (current.error) throw current.error;

    // 2. Insert into versions
    await this.client.from("media_asset_versions" as any).insert({
      asset_id: assetId,
      storage_path: current.data.storage_path,
      file_name: current.data.file_name,
      mime_type: current.data.mime_type,
      size_bytes: current.data.size_bytes,
      width: (current.data as any).width,
      height: (current.data as any).height,
      replaced_by: replacedBy,
    } as any);

    // 3. Update main asset
    const updated = await this.client
      .from("media_assets")
      .update({
        storage_path: storagePath,
        file_name: fileName,
        mime_type: mimeType,
        size_bytes: sizeBytes,
      } as any)
      .eq("id", assetId)
      .select()
      .single();

    if (updated.error) throw updated.error;
    return this.mapToDomain(updated.data);
  }

  async archiveAsset(organisationId: string, assetId: string): Promise<void> {
    const result = await this.client
      .from("media_assets")
      .update({ is_archived: true } as any)
      .eq("id", assetId)
      .eq("organisation_id", organisationId);

    if (result.error) throw result.error;
  }

  async getDeletionStatus(organisationId: string, assetId: string): Promise<MediaDeletionStatus> {
    const result = await this.client.rpc("get_media_deletion_status", {
      p_organisation_id: organisationId,
      p_asset_id: assetId,
    });
    if (result.error) throw result.error;
    return this.parseDeletionStatus(result.data);
  }

  async requestSafeDeletion(organisationId: string, assetId: string, idempotencyId: string): Promise<MediaDeletionResult> {
    const result = await this.client.rpc("request_media_safe_delete", {
      p_organisation_id: organisationId,
      p_asset_id: assetId,
      p_idempotency_id: idempotencyId,
    });
    if (result.error) throw result.error;
    const value = result.data as any;
    if (value?.outcome === "ACCEPTED" && typeof value.requestId === "string") {
      return {
        outcome: "ACCEPTED",
        requestId: value.requestId,
        cleanupState: value.cleanupState === "complete" ? "complete" : "pending",
        totalBytes: Number(value.totalBytes) || 0,
      };
    }
    return { outcome: "BLOCKED", reasons: this.parseReasons(value?.reasons) };
  }

  async getDeletionRequest(organisationId: string, requestId: string): Promise<import("../../core/domain/entities/media").MediaDeletionRequest | null> {
    const result = await this.client.from("media_deletion_requests").select("*")
      .eq("organisation_id", organisationId).eq("id", requestId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return null;
    return {
      requestId: result.data.id,
      organisationId: result.data.organisation_id,
      formerAssetId: result.data.former_asset_id,
      objectPaths: result.data.object_paths,
      cleanupState: result.data.cleanup_state,
      totalBytes: result.data.total_bytes,
    };
  }

  async recordCleanupResult(organisationId: string, requestId: string, succeeded: boolean, error?: string): Promise<void> {
    const result = await this.client.rpc("record_media_cleanup_result", {
      p_organisation_id: organisationId,
      p_request_id: requestId,
      p_succeeded: succeeded,
      p_error: error ?? null,
    });
    if (result.error) throw result.error;
  }

  private parseDeletionStatus(value: any): MediaDeletionStatus {
    if (value?.eligibility !== "ELIGIBLE" && value?.eligibility !== "BLOCKED") {
      return { eligibility: "BLOCKED", reasons: [{ code: "UNKNOWN_DEPENDENCY", count: 1 }] };
    }
    return {
      eligibility: value.eligibility,
      reasons: this.parseReasons(value.reasons),
      fileName: typeof value.fileName === "string" ? value.fileName : undefined,
      totalBytes: Number.isFinite(Number(value.totalBytes)) ? Number(value.totalBytes) : undefined,
      objectCount: Number.isFinite(Number(value.objectCount)) ? Number(value.objectCount) : undefined,
    };
  }

  private parseReasons(value: any): Array<{ code: MediaDeletionBlockCode; count: number }> {
    const allowed = new Set<MediaDeletionBlockCode>([
      "USED_BY_CONTENT", "USED_BY_CAMPAIGN", "USED_BY_COLLECTION", "USED_BY_BRAND_KIT",
      "PUBLISHING_DEPENDENCY", "HISTORICAL_INTELLIGENCE_REFERENCE", "HISTORICAL_USE", "INSUFFICIENT_PERMISSION",
      "INVALID_STORAGE_OWNERSHIP", "INCOMPLETE_PATH_INVENTORY", "UNKNOWN_DEPENDENCY",
    ]);
    if (!Array.isArray(value)) return [{ code: "UNKNOWN_DEPENDENCY", count: 1 }];
    const reasons = value.flatMap((reason: any) => allowed.has(reason?.code)
      ? [{ code: reason.code as MediaDeletionBlockCode, count: Math.max(1, Number(reason.count) || 1) }]
      : []);
    return reasons.length > 0 ? reasons : [];
  }

  async attachToCampaign(campaignId: string, assetId: string, attachedBy: string): Promise<void> {
    const result = await this.client.from("campaign_assets" as any).insert({
      campaign_id: campaignId,
      asset_id: assetId,
      attached_by: attachedBy,
    } as any);
    if (result.error) throw result.error;
  }

  async attachToDraft(draftId: string, assetId: string, attachedBy: string): Promise<void> {
    const result = await this.client.from("content_draft_assets" as any).insert({
      draft_id: draftId,
      asset_id: assetId,
      attached_by: attachedBy,
    } as any);
    if (result.error) throw result.error;
  }

  async getAssetVersions(assetId: string): Promise<MediaAssetVersion[]> {
    const result = await this.client
      .from("media_asset_versions" as any)
      .select()
      .eq("asset_id", assetId)
      .order("created_at", { ascending: false });

    if (result.error) throw result.error;
    return (result.data ?? []).map((row: any) => ({
      id: row.id,
      assetId: row.asset_id,
      storagePath: row.storage_path,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      width: row.width,
      height: row.height,
      replacedBy: row.replaced_by,
      createdAt: row.created_at,
    }));
  }

  // Collections
  async listCollections(organisationId: string): Promise<MediaCollection[]> {
    const result = await this.client
      .from("media_collections")
      .select(`
        *,
        media_collection_assets (
          asset_id,
          media_assets (*)
        )
      `)
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false });

    if (result.error) throw result.error;
    return (result.data ?? []).map((row: any) => {
      const col = this.mapCollectionToDomain(row);
      col.assets = (row.media_collection_assets ?? [])
        .map((mca: any) => mca.media_assets ? this.mapToDomain(mca.media_assets) : null)
        .filter((x: any): x is MediaAsset => x !== null);
      return col;
    });
  }

  async createCollection(organisationId: string, name: string, description: string | null, createdBy: string): Promise<MediaCollection> {
    const result = await this.client
      .from("media_collections")
      .insert({
        organisation_id: organisationId,
        name,
        description,
        created_by: createdBy,
      } as any)
      .select()
      .single();

    if (result.error) throw result.error;
    return this.mapCollectionToDomain(result.data);
  }

  async updateCollection(collectionId: string, name: string, description: string | null): Promise<MediaCollection> {
    const result = await this.client
      .from("media_collections")
      .update({
        name,
        description,
      } as any)
      .eq("id", collectionId)
      .select()
      .single();

    if (result.error) throw result.error;
    return this.mapCollectionToDomain(result.data);
  }

  async deleteCollection(organisationId: string, collectionId: string): Promise<void> {
    const result = await this.client
      .from("media_collections")
      .delete()
      .eq("id", collectionId)
      .eq("organisation_id", organisationId);

    if (result.error) throw result.error;
  }

  async attachAssetToCollection(collectionId: string, assetId: string, position = 0): Promise<void> {
    const result = await this.client.from("media_collection_assets").insert({
      collection_id: collectionId,
      asset_id: assetId,
      position,
    } as any);

    if (result.error) throw result.error;
  }

  async detachAssetFromCollection(collectionId: string, assetId: string): Promise<void> {
    const result = await this.client
      .from("media_collection_assets")
      .delete()
      .eq("collection_id", collectionId)
      .eq("asset_id", assetId);

    if (result.error) throw result.error;
  }

  async listAssetsForCollection(collectionId: string): Promise<MediaAsset[]> {
    const result = await this.client
      .from("media_collection_assets")
      .select(`
        media_assets (*)
      `)
      .eq("collection_id", collectionId)
      .order("position" as any, { ascending: true });

    if (result.error) throw result.error;
    return (result.data ?? [])
      .map((row: any) => row.media_assets ? this.mapToDomain(row.media_assets) : null)
      .filter((x: any): x is MediaAsset => x !== null);
  }

  // Brand Kits
  async listBrandKits(organisationId: string): Promise<BrandKit[]> {
    const result = await this.client
      .from("brand_kits")
      .select(`
        *,
        brand_kit_assets (
          role,
          asset_id,
          media_assets (*)
        )
      `)
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false });

    if (result.error) throw result.error;
    return (result.data ?? []).map((row: any) => {
      const bk = this.mapBrandKitToDomain(row);
      bk.assets = (row.brand_kit_assets ?? [])
        .map((ba: any) => {
          if (!ba.media_assets) return null;
          return {
            brandKitId: row.id,
            assetId: ba.asset_id,
            role: ba.role,
            asset: this.mapToDomain(ba.media_assets),
            createdAt: ba.created_at,
          };
        })
        .filter((x: any): x is any => x !== null);
      return bk;
    });
  }

  async createBrandKit(organisationId: string, name: string, colors: Record<string, string>[], typography: Record<string, string>[], toneNotes: string | null, usageGuidance: string | null, createdBy: string): Promise<BrandKit> {
    const result = await this.client
      .from("brand_kits")
      .insert({
        organisation_id: organisationId,
        name,
        colors,
        typography,
        tone_notes: toneNotes,
        usage_guidance: usageGuidance,
        created_by: createdBy,
      } as any)
      .select()
      .single();

    if (result.error) throw result.error;
    return this.mapBrandKitToDomain(result.data);
  }

  async updateBrandKit(brandKitId: string, name: string, colors: Record<string, string>[], typography: Record<string, string>[], toneNotes: string | null, usageGuidance: string | null): Promise<BrandKit> {
    const result = await this.client
      .from("brand_kits")
      .update({
        name,
        colors,
        typography,
        tone_notes: toneNotes,
        usage_guidance: usageGuidance,
      } as any)
      .eq("id", brandKitId)
      .select()
      .single();

    if (result.error) throw result.error;
    return this.mapBrandKitToDomain(result.data);
  }

  async deleteBrandKit(organisationId: string, brandKitId: string): Promise<void> {
    const result = await this.client
      .from("brand_kits")
      .delete()
      .eq("id", brandKitId)
      .eq("organisation_id", organisationId);

    if (result.error) throw result.error;
  }

  async attachAssetToBrandKit(brandKitId: string, assetId: string, role: string | null): Promise<void> {
    const result = await this.client.from("brand_kit_assets").insert({
      brand_kit_id: brandKitId,
      asset_id: assetId,
      role,
    } as any);

    if (result.error) throw result.error;
  }

  async detachAssetFromBrandKit(brandKitId: string, assetId: string): Promise<void> {
    const result = await this.client
      .from("brand_kit_assets")
      .delete()
      .eq("brand_kit_id", brandKitId)
      .eq("asset_id", assetId);

    if (result.error) throw result.error;
  }

  // Linking queries
  async listAssetsForDraft(draftId: string): Promise<MediaAsset[]> {
    const result = await this.client
      .from("content_draft_assets")
      .select(`
        media_assets (*)
      `)
      .eq("draft_id", draftId);

    if (result.error) throw result.error;
    return (result.data ?? [])
      .map((row: any) => row.media_assets ? this.mapToDomain(row.media_assets) : null)
      .filter((x: any): x is MediaAsset => x !== null);
  }

  async detachFromDraft(draftId: string, assetId: string): Promise<void> {
    const result = await this.client
      .from("content_draft_assets")
      .delete()
      .eq("draft_id", draftId)
      .eq("asset_id", assetId);

    if (result.error) throw result.error;
  }

  async listAssetsForCampaign(campaignId: string): Promise<MediaAsset[]> {
    const result = await this.client
      .from("campaign_assets")
      .select(`
        media_assets (*)
      `)
      .eq("campaign_id", campaignId);

    if (result.error) throw result.error;
    return (result.data ?? [])
      .map((row: any) => row.media_assets ? this.mapToDomain(row.media_assets) : null)
      .filter((x: any): x is MediaAsset => x !== null);
  }

  async detachFromCampaign(campaignId: string, assetId: string): Promise<void> {
    const result = await this.client
      .from("campaign_assets")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("asset_id", assetId);

    if (result.error) throw result.error;
  }

  async listDraftsReferencingAsset(assetId: string): Promise<Array<{ id: string; title: string }>> {
    // Step 1: find which draft_ids reference this asset
    const linkResult = await (this.client as any)
      .from("content_draft_assets")
      .select("draft_id")
      .eq("asset_id", assetId);

    if (linkResult.error) throw linkResult.error;
    const draftIds: string[] = (linkResult.data ?? []).map((r: any) => r.draft_id);
    if (draftIds.length === 0) return [];

    // Step 2: fetch titles so the error message is human-readable
    const draftsResult = await (this.client as any)
      .from("content_drafts")
      .select("id, title")
      .in("id", draftIds);

    if (draftsResult.error) throw draftsResult.error;
    return (draftsResult.data ?? []).map((r: any) => ({
      id: r.id as string,
      title: (r.title as string | null) ?? "Untitled draft",
    }));
  }

  async listCampaignsReferencingAsset(assetId: string): Promise<Array<{ id: string; name: string }>> {
    // Step 1: find which campaign_ids reference this asset
    const linkResult = await (this.client as any)
      .from("campaign_assets")
      .select("campaign_id")
      .eq("asset_id", assetId);

    if (linkResult.error) throw linkResult.error;
    const campaignIds: string[] = (linkResult.data ?? []).map((r: any) => r.campaign_id);
    if (campaignIds.length === 0) return [];

    // Step 2: fetch names so the error message is human-readable
    const campaignsResult = await (this.client as any)
      .from("campaigns")
      .select("id, name")
      .in("id", campaignIds);

    if (campaignsResult.error) throw campaignsResult.error;
    return (campaignsResult.data ?? []).map((r: any) => ({
      id: r.id as string,
      name: (r.name as string | null) ?? "Unnamed campaign",
    }));
  }

  private mapCollectionToDomain(row: any): MediaCollection {
    return {
      id: row.id,
      organisationId: row.organisation_id,
      name: row.name,
      description: row.description ?? null,
      createdBy: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assets: [],
    };
  }

  private mapBrandKitToDomain(row: any): BrandKit {
    return {
      id: row.id,
      organisationId: row.organisation_id,
      name: row.name,
      colors: row.colors ?? [],
      typography: row.typography ?? [],
      toneNotes: row.tone_notes ?? null,
      usageGuidance: row.usage_guidance ?? null,
      createdBy: null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assets: [],
    };
  }

  private mapToDomain(row: any): MediaAsset {
    return {
      id: row.id,
      organisationId: row.organisation_id,
      storagePath: row.storage_path,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      width: row.width,
      height: row.height,
      uploadedBy: null, // Depending on if we joined with profiles
      createdAt: row.created_at,
      
      title: row.title ?? null,
      thumbnailPath: row.thumbnail_path ?? null,
      category: row.category ?? null,
      description: row.description ?? null,
      altText: row.alt_text ?? null,
      tags: row.tags ?? [],
      brand: row.brand ?? null,
      duration: row.duration ?? null,
      copyrightOwner: row.copyright_owner ?? null,
      usageRights: row.usage_rights ?? null,
      expiresAt: row.expires_at ?? null,
      isAiGenerated: row.is_ai_generated ?? false,
      isArchived: row.is_archived ?? false,
      updatedAt: row.updated_at,
    };
  }
}

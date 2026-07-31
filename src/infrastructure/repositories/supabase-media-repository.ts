/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import type { MediaRepository, MediaAssetWriteModel } from "../../core/application/ports/media-port";
import type { MediaAsset, MediaCollection, MediaAssetVersion } from "../../core/domain/entities/media";
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

  async deleteAsset(organisationId: string, assetId: string): Promise<void> {
    const result = await this.client
      .from("media_assets")
      .delete()
      .eq("id", assetId)
      .eq("organisation_id", organisationId);

    if (result.error) throw result.error;
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

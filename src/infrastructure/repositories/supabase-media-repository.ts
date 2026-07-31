/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import type { MediaRepository, MediaAssetWriteModel } from "../../core/application/ports/media-port";
import type { MediaAsset } from "../../core/domain/entities/media";

export class SupabaseMediaRepository implements MediaRepository {
  constructor(private client: SupabaseClient<Database>) {}

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = query.eq("is_archived" as any, options.isArchived);
    }
    if (options?.typePrefix) {
      query = query.like("mime_type", `${options.typePrefix}%`);
    }

    query = query.order("created_at", { ascending: false });

    const result = await query;
    if (result.error) throw result.error;

    return result.data.map((row) => this.mapToDomain(row));
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

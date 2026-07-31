import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoragePort, UploadMediaInput } from "../../core/application/ports/storage-port";

export class SupabaseStoragePort implements StoragePort {
  private readonly BUCKET = "organisation-media";

  constructor(private client: SupabaseClient) {}

  async uploadMedia(organisationId: string, input: UploadMediaInput): Promise<string> {
    const timestamp = Date.now();
    const storagePath = `organisations/${organisationId}/${timestamp}_${input.fileName}`;
    
    const { error } = await this.client.storage
      .from(this.BUCKET)
      .upload(storagePath, input.fileBuffer, {
        contentType: input.mimeType,
        upsert: false,
      });

    if (error) {
      throw new Error(`Failed to upload media: ${error.message}`);
    }

    return storagePath;
  }

  async getSignedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error) {
      throw new Error(`Failed to generate signed URL: ${error.message}`);
    }

    return data.signedUrl;
  }

  async deleteMedia(storagePath: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.BUCKET)
      .remove([storagePath]);

    if (error) {
      throw new Error(`Failed to delete media: ${error.message}`);
    }
  }
}

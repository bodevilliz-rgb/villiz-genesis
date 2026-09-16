import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoragePort, UploadMediaInput } from "../../core/application/ports/storage-port";

// Process-local, bounded capability cache. Session JWT fingerprints isolate users,
// and renewed sessions; project identity is separately included below.
// A cache hit only reuses a capability already issued under the same credentials.
const signedUrls = new Map<string, { refreshAt: number; url: Promise<string> }>();
export const SIGNED_URL_CACHE_LIMIT = 512;
let instanceSequence = 0;

export class SupabaseStoragePort implements StoragePort {
  private readonly cacheIdentity = `client-${++instanceSequence}`;
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

  async createSignedUploadUrl(storagePath: string): Promise<{ path: string; token: string }> {
    const { data, error } = await this.client.storage
      .from(this.BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      throw new Error(`Failed to create signed upload URL: ${error?.message ?? "no data returned"}`);
    }

    return { path: data.path, token: data.token };
  }

  async getSignedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
    const session = await this.client.auth?.getSession();
    const token = session?.data.session?.access_token;
    let project = this.cacheIdentity;
    try {
      const projectUrl: unknown = Reflect.get(this.client, "supabaseUrl");
      if (typeof projectUrl !== "string") throw new Error("Missing project identity");
      const url = new URL(projectUrl);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash) {
        project = url.href.replace(/\/$/, "");
      }
    } catch { /* Unidentifiable clients remain instance-local. */ }
    const scope = token ? createHash("sha256").update(token).digest("hex") : this.cacheIdentity;
    const key = JSON.stringify([project, scope, this.BUCKET, storagePath, expiresInSeconds]);
    const now = Date.now();
    const cached = signedUrls.get(key);
    if (cached && now < cached.refreshAt) return cached.url;
    signedUrls.delete(key);
    // Keep at least 10% of the lifetime for consumers (36 minutes for publishing).
    const refreshAt = now + Math.max(0, expiresInSeconds * 1000 - expiresInSeconds * 100);
    const url = this.client.storage.from(this.BUCKET).createSignedUrl(storagePath, expiresInSeconds)
      .then(({ data, error }) => {
        if (error) throw error;
        return data!.signedUrl;
      });
    const entry = { refreshAt, url };
    signedUrls.set(key, entry);
    while (signedUrls.size > SIGNED_URL_CACHE_LIMIT) signedUrls.delete(signedUrls.keys().next().value!);
    try {
      return await url;
    } catch (error) {
      if (signedUrls.get(key) === entry) signedUrls.delete(key);
      // Preserve structured quota/status fields for the worker circuit.
      throw error;
    }
  }

  async downloadMedia(storagePath: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage.from(this.BUCKET).download(storagePath);
    if (error || !data) throw new Error(`Failed to download media for analysis: ${error?.message ?? "no data returned"}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  async deleteMedia(storagePath: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.BUCKET)
      .remove([storagePath]);

    if (error) {
      throw new Error(`Failed to delete media: ${error.message}`);
    }
  }

  async deleteMediaFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.client.storage
      .from(this.BUCKET)
      .remove(paths);

    if (error) {
      throw new Error(`Failed to delete media files: ${error.message}`);
    }
  }
}

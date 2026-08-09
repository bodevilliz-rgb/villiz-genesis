export interface UploadMediaInput {
  fileName: string;
  mimeType: string;
  fileBuffer: ArrayBuffer | Uint8Array;
}

export interface StoragePort {
  /**
   * Uploads a file to the organisation's media storage and returns the storage path.
   * Path should be `organisations/${organisationId}/${fileName}`.
   */
  uploadMedia(organisationId: string, input: UploadMediaInput): Promise<string>;
  
  /**
   * Generates a signed URL for reading an asset.
   */
  getSignedUrl(storagePath: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Issues a short-lived, single-path signed upload authorisation so the
   * browser can PUT the file bytes straight into the private bucket without
   * routing them through a serverless function (Vercel rejects request
   * bodies over 4.5 MB with FUNCTION_PAYLOAD_TOO_LARGE). The token is only
   * valid for the exact server-generated `storagePath` it was issued for.
   */
  createSignedUploadUrl(storagePath: string): Promise<{ path: string; token: string }>;

  /**
   * Removes a file from storage permanently.
   */
  deleteMedia(storagePath: string): Promise<void>;

  /**
   * Removes multiple files from storage in a single call.
   * No-op when paths is empty. Throws if any removal fails.
   */
  deleteMediaFiles(paths: string[]): Promise<void>;
}

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
   * Removes a file from storage permanently.
   */
  deleteMedia(storagePath: string): Promise<void>;

  /**
   * Removes multiple files from storage in a single call.
   * No-op when paths is empty. Throws if any removal fails.
   */
  deleteMediaFiles(paths: string[]): Promise<void>;
}

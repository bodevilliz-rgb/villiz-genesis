"use client";
import { useState, useRef } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { requestMediaUploadAction, registerUploadedMediaAction } from "@/server/actions/media";
import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser-client";
import {
  MEDIA_UPLOAD_ALLOWED_MIME_TYPES,
  ORGANISATION_MEDIA_BUCKET,
  validateMediaUpload,
} from "@/core/domain/entities/media-upload";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface UploadZoneProps {
  organisationId: string;
  onSuccess?: (assetId: string) => void;
}

/**
 * Direct-to-storage upload: the file's bytes go straight from the browser to
 * the private Supabase bucket using a short-lived, server-issued signed
 * upload token — they never pass through a Vercel serverless function, whose
 * 4.5 MB request-body ceiling made every larger upload fail with
 * FUNCTION_PAYLOAD_TOO_LARGE. Only two small JSON requests touch the server:
 * ticket issuance and metadata registration.
 */
type UploadPhase = "idle" | "preparing" | "uploading" | "registering";

const PHASE_LABEL: Record<Exclude<UploadPhase, "idle">, string> = {
  preparing: "Preparing upload…",
  uploading: "Uploading…",
  registering: "Registering asset…",
};

export function MediaUploadZone({ organisationId, onSuccess }: UploadZoneProps) {
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isBusy = phase !== "idle";

  const acceptFile = (candidate: File) => {
    // Fast-fail in the browser before any server round-trip — same rules the
    // server enforces authoritatively (shared media-upload module).
    const validation = validateMediaUpload({ mimeType: candidate.type, sizeBytes: candidate.size });
    if (!validation.valid) {
      toast.error(validation.reason);
      return;
    }
    setFile(candidate);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      acceptFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      acceptFile(e.target.files[0]);
    }
  };

  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async () => {
    if (!file || isBusy) return;

    try {
      // 1. Server issues a signed upload token for a server-generated,
      //    organisation-scoped path (auth + membership + rules checked there).
      setPhase("preparing");
      const ticket = await requestMediaUploadAction(organisationId, {
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (ticket.status !== "ready") {
        toast.error(ticket.message || "Could not prepare the upload.");
        return;
      }

      // 2. Bytes go directly to the private bucket — never through Vercel.
      setPhase("uploading");
      const supabase = createBrowserSupabaseClient();
      const { error: uploadError } = await supabase.storage
        .from(ORGANISATION_MEDIA_BUCKET)
        .uploadToSignedUrl(ticket.storagePath, ticket.token, file, { contentType: file.type });
      if (uploadError) {
        toast.error(`The file could not be uploaded to storage: ${uploadError.message}`);
        return;
      }

      // 3. Register the asset row.
      setPhase("registering");
      const formData = new FormData();
      formData.append("organisationId", organisationId);
      formData.append("storagePath", ticket.storagePath);
      formData.append("fileName", file.name);
      formData.append("mimeType", file.type);
      formData.append("sizeBytes", String(file.size));
      formData.append("title", file.name);

      const result = await registerUploadedMediaAction({ status: "idle", message: "" }, formData);
      if (result.status === "success") {
        toast.success("Upload complete.");
        setFile(null);
        if (onSuccess && result.resourceId) {
          onSuccess(result.resourceId);
        }
      } else {
        toast.error(result.message || "The upload finished but the asset could not be registered. Please try again.");
      }
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
      <h3 className="text-[14px] font-medium text-foreground">Upload new asset</h3>
      <div
        className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
          dragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-muted-foreground/30 hover:bg-muted/30"
        }`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
          accept={MEDIA_UPLOAD_ALLOWED_MIME_TYPES.join(",")}
        />

        <div className="flex flex-col items-center text-center">
          <div className="mb-3 rounded-full bg-muted p-2.5">
            <Upload className="size-5 text-muted-foreground" />
          </div>
          {file ? (
            <div className="flex flex-col items-center">
              <p className="max-w-[200px] truncate text-[13px] font-medium text-foreground">
                {file.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              <button
                type="button"
                onClick={() => setFile(null)}
                disabled={isBusy}
                className="mt-2 flex items-center gap-1 text-[11px] text-negative hover:underline disabled:opacity-50"
              >
                <X className="size-3" /> Clear selection
              </button>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-foreground">
                Drag and drop your file here, or{" "}
                <button
                  type="button"
                  onClick={onButtonClick}
                  className="font-medium text-primary hover:underline"
                >
                  browse files
                </button>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Supports JPEG, PNG, WebP, GIF, AVIF, MP4, QuickTime, WebM and PDF up to 50MB.
              </p>
            </>
          )}
        </div>
      </div>

      {file && (
        <Button
          onClick={handleUpload}
          variant="primary"
          disabled={isBusy}
          className="w-full"
        >
          {isBusy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> {PHASE_LABEL[phase as Exclude<UploadPhase, "idle">]}
            </>
          ) : (
            "Upload file"
          )}
        </Button>
      )}
    </div>
  );
}

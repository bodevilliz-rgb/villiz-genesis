"use client";
import { useTransition, useState, useRef } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { uploadMediaAction } from "@/server/actions/media";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface UploadZoneProps {
  organisationId: string;
  onSuccess?: (assetId: string) => void;
}

export function MediaUploadZone({ organisationId, onSuccess }: UploadZoneProps) {
  const [isPending, startTransition] = useTransition();
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const onButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = () => {
    if (!file) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("organisationId", organisationId);
      formData.append("file", file);
      formData.append("title", file.name);

      const result = await uploadMediaAction({ status: "idle", message: "" }, formData);
      if (result.status === "success") {
        toast.success(result.message);
        setFile(null);
        if (onSuccess && result.resourceId) {
          onSuccess(result.resourceId);
        }
      } else {
        toast.error(result.message);
      }
    });
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
          accept="image/*,video/*,audio/*,application/pdf"
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
                className="mt-2 flex items-center gap-1 text-[11px] text-negative hover:underline"
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
                Supports Images, Videos, Audio and PDFs up to 50MB.
              </p>
            </>
          )}
        </div>
      </div>

      {file && (
        <Button
          onClick={handleUpload}
          variant="primary"
          disabled={isPending}
          className="w-full"
        >
          {isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Uploading…
            </>
          ) : (
            "Upload file"
          )}
        </Button>
      )}
    </div>
  );
}

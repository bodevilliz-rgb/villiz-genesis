"use client";
import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Video, Music, Loader2, Archive, Trash2, FileUp, Download } from "lucide-react";
import type { MediaAsset, MediaAssetVersion } from "@/core/domain/entities/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { updateMediaMetadataAction, requestMediaUploadAction, registerMediaReplacementAction, archiveMediaAction, deleteMediaAction } from "@/server/actions/media";
import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser-client";
import { ORGANISATION_MEDIA_BUCKET, validateMediaUpload } from "@/core/domain/entities/media-upload";
import { routes } from "@/lib/routes";
import { toast } from "sonner";

interface AssetDetailFormProps {
  organisationId: string;
  asset: MediaAsset;
  versions: MediaAssetVersion[];
  signedUrl: string;
  versionUrls: Record<string, string>;
}

export function AssetDetailForm({
  organisationId,
  asset,
  versions,
  signedUrl,
  versionUrls,
}: AssetDetailFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [replaceFile, setReplaceFile] = useState<File | null>(null);

  // Form states
  const [title, setTitle] = useState(asset.title || "");
  const [category, setCategory] = useState(asset.category || "");
  const [description, setDescription] = useState(asset.description || "");
  const [altText, setAltText] = useState(asset.altText || "");
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [brand, setBrand] = useState(asset.brand || "");
  const [isAiGenerated, setIsAiGenerated] = useState(asset.isAiGenerated);
  const [isArchived, setIsArchived] = useState(asset.isArchived);
  const [copyrightOwner, setCopyrightOwner] = useState(asset.copyrightOwner || "");
  const [usageRights, setUsageRights] = useState(asset.usageRights || "");
  const [expiresAt, setExpiresAt] = useState(
    asset.expiresAt ? new Date(asset.expiresAt).toISOString().split("T")[0] : ""
  );

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();

    startTransition(async () => {
      const formData = new FormData();
      formData.append("assetId", asset.id);
      formData.append("organisationId", organisationId);
      formData.append("title", title);
      formData.append("category", category);
      formData.append("description", description);
      formData.append("altText", altText);
      formData.append("tags", tags);
      formData.append("brand", brand);
      formData.append("isAiGenerated", String(isAiGenerated));
      formData.append("isArchived", String(isArchived));
      formData.append("copyrightOwner", copyrightOwner);
      formData.append("usageRights", usageRights);
      if (expiresAt) formData.append("expiresAt", new Date(expiresAt).toISOString());

      const result = await updateMediaMetadataAction({ status: "idle", message: "" }, formData);
      if (result.status === "success") {
        toast.success(result.message);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  const handleReplaceVersion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replaceFile) return;

    // Same direct-to-storage transport as the Media Library upload zone — the
    // replacement's bytes never pass through a Vercel serverless function.
    startTransition(async () => {
      const validation = validateMediaUpload({ mimeType: replaceFile.type, sizeBytes: replaceFile.size });
      if (!validation.valid) {
        toast.error(validation.reason);
        return;
      }

      const ticket = await requestMediaUploadAction(organisationId, {
        fileName: replaceFile.name,
        mimeType: replaceFile.type,
        sizeBytes: replaceFile.size,
      });
      if (ticket.status !== "ready") {
        toast.error(ticket.message || "Could not prepare the upload.");
        return;
      }

      const supabase = createBrowserSupabaseClient();
      const { error: uploadError } = await supabase.storage
        .from(ORGANISATION_MEDIA_BUCKET)
        .uploadToSignedUrl(ticket.storagePath, ticket.token, replaceFile, { contentType: replaceFile.type });
      if (uploadError) {
        toast.error(`The file could not be uploaded to storage: ${uploadError.message}`);
        return;
      }

      const formData = new FormData();
      formData.append("assetId", asset.id);
      formData.append("organisationId", organisationId);
      formData.append("storagePath", ticket.storagePath);
      formData.append("fileName", replaceFile.name);
      formData.append("mimeType", replaceFile.type);
      formData.append("sizeBytes", String(replaceFile.size));

      const result = await registerMediaReplacementAction({ status: "idle", message: "" }, formData);
      if (result.status === "success") {
        toast.success(result.message);
        setReplaceFile(null);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  const handleArchive = () => {
    startTransition(async () => {
      const result = await archiveMediaAction(organisationId, asset.id);
      if (result.status === "success") {
        toast.success(result.message);
        setIsArchived(true);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    });
  };

  const handleDelete = () => {
    if (!confirm("Are you sure you want to delete this asset permanently? This will fail if it is attached to campaigns or drafts.")) return;

    startTransition(async () => {
      const result = await deleteMediaAction(organisationId, asset.id);
      if (result.status === "success") {
        toast.success(result.message);
        router.push(routes.organisations.media.index(organisationId));
      } else {
        toast.error(result.message);
      }
    });
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return <ImageIcon className="size-6 text-primary" />;
    if (mimeType.startsWith("video/")) return <Video className="size-6 text-primary" />;
    if (mimeType.startsWith("audio/")) return <Music className="size-6 text-primary" />;
    return <FileText className="size-6 text-primary" />;
  };

  const getFormattedSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Left side: Asset Preview and Version Replacement */}
      <div className="flex flex-col gap-6 lg:col-span-1">
        {/* Preview Frame */}
        <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
          <div className="relative aspect-video w-full bg-muted flex items-center justify-center p-4">
            {asset.mimeType.startsWith("image/") && signedUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={signedUrl}
                alt={asset.altText || asset.title || asset.fileName}
                className="max-h-full max-w-full object-contain rounded"
              />
            ) : (
              <div className="flex flex-col items-center text-muted-foreground gap-2">
                {getFileIcon(asset.mimeType)}
                <span className="text-[12px] font-medium">{asset.fileName}</span>
                <span className="text-[10px] uppercase font-mono bg-muted/80 px-2 py-0.5 rounded border border-border">
                  {asset.mimeType.split("/")[1]}
                </span>
              </div>
            )}
          </div>
          <div className="p-4 bg-muted/20 border-t border-border flex flex-col gap-2">
            <div className="flex justify-between items-center text-[12px]">
              <span className="text-muted-foreground">File name:</span>
              <span className="font-medium text-foreground truncate max-w-[160px]">{asset.fileName}</span>
            </div>
            <div className="flex justify-between items-center text-[12px]">
              <span className="text-muted-foreground">Mime type:</span>
              <span className="font-medium text-foreground">{asset.mimeType}</span>
            </div>
            <div className="flex justify-between items-center text-[12px]">
              <span className="text-muted-foreground">File size:</span>
              <span className="font-medium text-foreground">{getFormattedSize(asset.sizeBytes)}</span>
            </div>
            <div className="flex justify-between items-center text-[12px]">
              <span className="text-muted-foreground">Upload date:</span>
              <span className="font-medium text-foreground">{new Date(asset.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Version Replacement */}
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm flex flex-col gap-4">
          <h4 className="flex items-center gap-2 text-[14px] font-medium text-foreground">
            <FileUp className="size-4 text-primary" /> Replace Current Version
          </h4>
          <p className="text-[11px] text-muted-foreground">
            Replacing files keeps campaigns and drafts updated automatically with the latest version.
          </p>

          <form onSubmit={handleReplaceVersion} className="flex flex-col gap-3">
            <input
              type="file"
              onChange={(e) => setReplaceFile(e.target.files?.[0] || null)}
              className="w-full text-[12px] text-muted-foreground file:mr-3 file:py-1 file:px-2.5 file:rounded file:border file:border-border file:text-[11px] file:font-medium file:bg-muted file:text-foreground file:cursor-pointer hover:file:bg-muted/80"
              accept={asset.mimeType}
            />
            {replaceFile && (
              <Button type="submit" variant="primary" disabled={isPending} className="w-full h-8 text-[12px]">
                {isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Upload replacement version"}
              </Button>
            )}
          </form>
        </div>

        {/* Danger Zone */}
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm flex flex-col gap-3">
          <h4 className="text-[14px] font-medium text-foreground">Danger Zone</h4>
          <div className="flex flex-col gap-2">
            {!isArchived && (
              <Button onClick={handleArchive} variant="ghost" disabled={isPending} className="w-full justify-start text-[12px] h-9">
                <Archive className="size-4 mr-2" /> Archive asset
              </Button>
            )}
            <Button onClick={handleDelete} variant="ghost" disabled={isPending} className="w-full justify-start text-negative text-[12px] h-9">
              <Trash2 className="size-4 mr-2" /> Delete permanently
            </Button>
          </div>
        </div>
      </div>

      {/* Right side: Metadata Forms and Versions Table */}
      <div className="flex flex-col gap-6 lg:col-span-2">
        {/* Metadata Editor */}
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h4 className="text-md font-semibold text-foreground border-b border-border pb-3 mb-5">Asset Metadata</h4>

          <form onSubmit={handleUpdate} className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="title" label="Asset Title" required>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Descriptive title..." />
              </Field>

              <Field id="category" label="Category / Classification">
                <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Choose category...</option>
                  <option value="photography">Photography</option>
                  <option value="logo">Logo & Mark</option>
                  <option value="graphic">Graphic & Visual</option>
                  <option value="icon">Iconography</option>
                  <option value="document">Documentation / Copy</option>
                </Select>
              </Field>
            </div>

            <Field id="description" label="Description">
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Provide context about what this file represents..." className="h-20" />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="altText" label="Alt Text / Accessibility Label" hint="For screen readers">
                <Input id="altText" value={altText} onChange={(e) => setAltText(e.target.value)} placeholder="Describe image contents..." />
              </Field>

              <Field id="tags" label="Tags" hint="Comma-separated">
                <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="summer2026, logo, hero" />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="brand" label="Associated Brand / Campaign">
                <Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Genesis Main" />
              </Field>

              <Field id="expiresAt" label="Usage Rights Expiry Date">
                <Input id="expiresAt" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="copyrightOwner" label="Copyright Owner / Agency">
                <Input id="copyrightOwner" value={copyrightOwner} onChange={(e) => setCopyrightOwner(e.target.value)} placeholder="e.g. Villiz Pixels Ltd" />
              </Field>

              <Field id="usageRights" label="Usage Rights Details">
                <Input id="usageRights" value={usageRights} onChange={(e) => setUsageRights(e.target.value)} placeholder="Unlimited local use, social channels only" />
              </Field>
            </div>

            <div className="flex flex-wrap gap-6 items-center">
              <label className="flex items-center gap-2 text-[13px] font-medium text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAiGenerated}
                  onChange={(e) => setIsAiGenerated(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary size-4"
                />
                Mark as AI Generated / Co-created
              </label>

              <label className="flex items-center gap-2 text-[13px] font-medium text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={isArchived}
                  onChange={(e) => setIsArchived(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary size-4"
                />
                Archive asset (hide from catalog search)
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-4 mt-2">
              <Button type="submit" variant="primary" disabled={isPending}>
                {isPending ? <Loader2 className="size-3.5 animate-spin" /> : "Save changes"}
              </Button>
            </div>
          </form>
        </div>

        {/* Version History Table */}
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <h4 className="text-md font-semibold text-foreground border-b border-border pb-3 mb-4">Version History</h4>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground font-medium">
                  <th className="pb-2 font-mono">Ver</th>
                  <th className="pb-2">File name</th>
                  <th className="pb-2">File size</th>
                  <th className="pb-2">Upload Date</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {/* Active Current Version */}
                <tr className="bg-primary/5">
                  <td className="py-2.5 font-mono text-primary font-bold">Active</td>
                  <td className="py-2.5 font-medium text-foreground">{asset.fileName}</td>
                  <td className="py-2.5 text-muted-foreground">{getFormattedSize(asset.sizeBytes)}</td>
                  <td className="py-2.5 text-muted-foreground">{new Date(asset.updatedAt).toLocaleDateString()}</td>
                  <td className="py-2.5 text-right">
                    {asset.mimeType.startsWith("image/") && signedUrl && (
                      <a href={signedUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline flex items-center gap-1 justify-end font-medium">
                        <Download className="size-3" /> Preview / Save
                      </a>
                    )}
                  </td>
                </tr>

                {/* Historical Versions */}
                {versions.map((ver, idx) => {
                  const vUrl = versionUrls[ver.id];
                  const verNum = versions.length - idx;
                  return (
                    <tr key={ver.id} className="hover:bg-muted/30">
                      <td className="py-2.5 font-mono text-muted-foreground">v{verNum}</td>
                      <td className="py-2.5 text-muted-foreground">{ver.fileName}</td>
                      <td className="py-2.5 text-muted-foreground">{getFormattedSize(ver.sizeBytes)}</td>
                      <td className="py-2.5 text-muted-foreground">{new Date(ver.createdAt).toLocaleDateString()}</td>
                      <td className="py-2.5 text-right">
                        {ver.mimeType.startsWith("image/") && vUrl && (
                          <a href={vUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline flex items-center gap-1 justify-end">
                            <Download className="size-3" /> Preview
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {versions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground italic">
                      No historical versions exist. This represents the initial upload version.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

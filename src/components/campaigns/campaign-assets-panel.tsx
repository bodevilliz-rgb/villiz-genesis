"use client";
import { useState, useTransition } from "react";
import { Image as ImageIcon, Video, Music, FileText, X, Paperclip, Plus } from "lucide-react";
import type { MediaAsset, MediaAssetListItem } from "@/core/domain/entities/media";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { attachAssetToCampaignAction, detachAssetFromCampaignAction } from "@/server/actions/media";
import { toast } from "sonner";

type CampaignAssetChoice = Pick<MediaAssetListItem, "id" | "title" | "fileName" | "mimeType" | "storagePath">;

interface CampaignAssetsPanelProps {
  organisationId: string;
  campaignId: string;
  allAssets: CampaignAssetChoice[];
  attachedAssets: MediaAsset[];
  signedUrls: Record<string, string>;
  canWrite: boolean;
}

export function CampaignAssetsPanel({ organisationId, campaignId, allAssets, attachedAssets, signedUrls, canWrite }: CampaignAssetsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [showModal, setShowModal] = useState(false);
  const [localAssets, setLocalAssets] = useState<CampaignAssetChoice[]>(attachedAssets);

  const handleAttach = (asset: CampaignAssetChoice) => {
    startTransition(async () => {
      const result = await attachAssetToCampaignAction(campaignId, asset.id, organisationId);
      if (result.status === "success") {
        toast.success(result.message);
        setLocalAssets([...localAssets, asset]);
        setShowModal(false);
      } else toast.error(result.message);
    });
  };

  const handleDetach = (assetId: string) => {
    startTransition(async () => {
      const result = await detachAssetFromCampaignAction(campaignId, assetId, organisationId);
      if (result.status === "success") {
        toast.success(result.message);
        setLocalAssets(localAssets.filter((asset) => asset.id !== assetId));
      } else toast.error(result.message);
    });
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return <ImageIcon className="size-4 text-primary" />;
    if (mimeType.startsWith("video/")) return <Video className="size-4 text-primary" />;
    if (mimeType.startsWith("audio/")) return <Music className="size-4 text-primary" />;
    return <FileText className="size-4 text-primary" />;
  };

  const availableAssets = allAssets.filter((asset) => !localAssets.some((local) => local.id === asset.id));

  return (
    <Card className="bg-[#050505] border border-border">
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <CardTitle className="flex items-center gap-2"><Paperclip className="size-4 text-primary" /> Campaign Media & Creative Assets</CardTitle>
        {canWrite && <Button onClick={() => setShowModal(true)} variant="ghost" size="sm" className="h-7 text-[11px]"><Plus className="size-3.5 mr-1" /> Link asset</Button>}
      </CardHeader>
      <CardContent>
        {localAssets.length === 0 ? <p className="text-[12px] text-muted-foreground italic py-2">No creative templates, visual logos, or photography attached to this campaign.</p> : (
          <div className="grid gap-3 sm:grid-cols-2">{localAssets.map((asset) => {
            const sUrl = signedUrls[asset.storagePath];
            return <div key={asset.id} className="flex items-center justify-between p-2 rounded-md border border-border bg-card">
              <div className="flex items-center gap-2.5 truncate">
                {asset.mimeType.startsWith("image/") && sUrl ? <img src={sUrl} alt="" className="size-8 rounded object-cover border border-border" /> : <div className="size-8 rounded border border-border bg-muted flex items-center justify-center">{getFileIcon(asset.mimeType)}</div>}
                <div className="flex flex-col truncate"><span className="text-[12px] font-medium text-foreground truncate">{asset.title || asset.fileName}</span><span className="text-[10px] text-muted-foreground uppercase">{asset.mimeType.split("/")[1]}</span></div>
              </div>
              {canWrite && <button onClick={() => handleDetach(asset.id)} disabled={isPending} className="text-muted-foreground hover:text-negative p-1 rounded transition-colors"><X className="size-3.5" /></button>}
            </div>;
          })}</div>
        )}
      </CardContent>

      {showModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"><div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border pb-3 mb-4"><h4 className="text-md font-semibold text-foreground">Link Asset to Campaign</h4><button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button></div>
        <div className="overflow-y-auto flex-1 flex flex-col gap-2">
          {availableAssets.map((asset) => <div key={asset.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/40 border border-transparent hover:border-border">
            <div className="flex items-center gap-3">{asset.mimeType.startsWith("image/") && signedUrls[asset.storagePath] ? <img src={signedUrls[asset.storagePath]} alt="" className="size-8 rounded object-cover border border-border" /> : <div className="size-8 rounded border border-border bg-muted flex items-center justify-center">{getFileIcon(asset.mimeType)}</div>}<div><p className="text-[12px] font-medium text-foreground truncate max-w-[200px]">{asset.title || asset.fileName}</p><p className="text-[10px] text-muted-foreground uppercase">{asset.mimeType.split("/")[1]}</p></div></div>
            <Button onClick={() => handleAttach(asset)} variant="ghost" className="text-primary text-[11px] font-medium py-1 px-2.5 h-auto" disabled={isPending}>Link</Button>
          </div>)}
          {availableAssets.length === 0 && <p className="text-center text-[12px] text-muted-foreground py-8">All available assets are already linked to this campaign.</p>}
        </div>
        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border"><Button onClick={() => setShowModal(false)} variant="primary">Cancel</Button></div>
      </div></div>}
    </Card>
  );
}

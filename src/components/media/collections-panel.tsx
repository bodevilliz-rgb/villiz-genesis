"use client";
import { useState, useTransition } from "react";
import { Folders, Plus, Trash2, Folder, X, Image as ImageIcon, FileText, Video, Music } from "lucide-react";
import type { MediaCollection, MediaAsset } from "@/core/domain/entities/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { createCollectionAction, deleteCollectionAction, attachAssetToCollectionAction, detachAssetFromCollectionAction } from "@/server/actions/media";
import { toast } from "sonner";

interface CollectionsPanelProps {
  organisationId: string;
  collections: MediaCollection[];
  allAssets: MediaAsset[];
  signedUrls: Record<string, string>;
}

export function CollectionsPanel({ organisationId, collections, allAssets, signedUrls }: CollectionsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [activeCollection, setActiveCollection] = useState<MediaCollection | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddAssetModal, setShowAddAssetModal] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("organisationId", organisationId);
      formData.append("name", name);
      formData.append("description", description);

      const result = await createCollectionAction({ status: "idle", message: "" }, formData);
      if (result.status === "success") {
        toast.success(result.message);
        setName("");
        setDescription("");
        setShowCreateModal(false);
        // Page gets revalidated, so list updates. 
        // We will just let Server Actions handle caching.
      } else {
        toast.error(result.message);
      }
    });
  };

  const handleDeleteCollection = (collectionId: string) => {
    if (!confirm("Are you sure you want to delete this collection? Attached assets will not be deleted.")) return;

    startTransition(async () => {
      const result = await deleteCollectionAction(organisationId, collectionId);
      if (result.status === "success") {
        toast.success(result.message);
        if (activeCollection?.id === collectionId) {
          setActiveCollection(null);
        }
      } else {
        toast.error(result.message);
      }
    });
  };

  const handleAttachAsset = (assetId: string) => {
    if (!activeCollection) return;

    startTransition(async () => {
      const result = await attachAssetToCollectionAction(activeCollection.id, assetId, organisationId);
      if (result.status === "success") {
        toast.success(result.message);
        // Add to active view list manually to avoid waiting for reload delay
        const asset = allAssets.find(a => a.id === assetId);
        if (asset && activeCollection.assets) {
          setActiveCollection({
            ...activeCollection,
            assets: [...activeCollection.assets, asset]
          });
        }
      } else {
        toast.error(result.message);
      }
    });
  };

  const handleDetachAsset = (assetId: string) => {
    if (!activeCollection) return;

    startTransition(async () => {
      const result = await detachAssetFromCollectionAction(activeCollection.id, assetId, organisationId);
      if (result.status === "success") {
        toast.success(result.message);
        if (activeCollection.assets) {
          setActiveCollection({
            ...activeCollection,
            assets: activeCollection.assets.filter(a => a.id !== assetId)
          });
        }
      } else {
        toast.error(result.message);
      }
    });
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return <ImageIcon className="size-4" />;
    if (mimeType.startsWith("video/")) return <Video className="size-4" />;
    if (mimeType.startsWith("audio/")) return <Music className="size-4" />;
    return <FileText className="size-4" />;
  };

  return (
    <div className="flex flex-col gap-6">
      {activeCollection ? (
        // Detailed Collection View
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveCollection(null)}
                className="text-[12px] text-muted-foreground hover:text-foreground hover:underline"
              >
                ← All Collections
              </button>
              <span className="text-muted-foreground">/</span>
              <h3 className="text-lg font-semibold text-foreground">{activeCollection.name}</h3>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => setShowAddAssetModal(true)} variant="primary">
                Add Asset
              </Button>
              <Button onClick={() => handleDeleteCollection(activeCollection.id)} variant="ghost" className="text-negative">
                <Trash2 className="size-4" /> Delete Collection
              </Button>
            </div>
          </div>

          {activeCollection.description && (
            <p className="text-[13px] text-muted-foreground">{activeCollection.description}</p>
          )}

          {/* Collection Assets list */}
          {!activeCollection.assets || activeCollection.assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-center">
              <Folder className="size-8 text-muted-foreground" />
              <h4 className="mt-3 text-[14px] font-medium text-foreground">No assets in this collection</h4>
              <p className="mt-1 text-[12px] text-muted-foreground max-w-xs">
                Add assets from your Media Library catalog to group them together.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
              {activeCollection.assets.map((asset) => {
                const signedUrl = signedUrls[asset.storagePath];
                const isImg = asset.mimeType.startsWith("image/");
                return (
                  <div key={asset.id} className="group relative rounded-lg border border-border bg-card overflow-hidden">
                    <div className="relative aspect-video w-full bg-muted flex items-center justify-center">
                      {isImg && signedUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={signedUrl} alt={asset.title || asset.fileName || "Collection Asset Preview"} className="size-full object-cover" />
                      ) : (
                        getFileIcon(asset.mimeType)
                      )}
                      
                      <button
                        onClick={() => handleDetachAsset(asset.id)}
                        className="absolute right-2 top-2 rounded bg-black/75 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-negative"
                        title="Remove from collection"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <div className="p-3">
                      <p className="text-[12px] font-medium truncate text-foreground">{asset.title || asset.fileName}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        // Grid View of All Collections
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h3 className="text-md font-medium text-foreground">Media Collections</h3>
            <Button onClick={() => setShowCreateModal(true)} variant="primary">
              <Plus className="size-4" /> New Collection
            </Button>
          </div>

          {collections.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-center">
              <Folders className="size-8 text-muted-foreground" />
              <h4 className="mt-3 text-[14px] font-medium text-foreground">No collections yet</h4>
              <p className="mt-1 text-[12px] text-muted-foreground max-w-xs">
                Group media files by social campaign, content category, or specific asset roles.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {collections.map((col) => (
                <div
                  key={col.id}
                  onClick={() => setActiveCollection(col)}
                  className="group flex flex-col justify-between cursor-pointer rounded-lg border border-border bg-card p-5 transition-colors hover:border-muted-foreground/30"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Folder className="size-5 text-primary" />
                      <h4 className="text-[14px] font-medium text-foreground group-hover:underline">{col.name}</h4>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCollection(col.id);
                      }}
                      className="text-muted-foreground hover:text-negative"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  
                  {col.description && (
                    <p className="mt-2 text-[12px] text-muted-foreground line-clamp-2">{col.description}</p>
                  )}

                  <div className="mt-4 text-[11px] text-muted-foreground">
                    {col.assets?.length || 0} assets grouped
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Collection Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h4 className="text-md font-semibold text-foreground">Create New Collection</h4>
              <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <Field id="name" label="Collection Name" required>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Social Promo Assets" required />
              </Field>
              <Field id="desc" label="Description">
                <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Explain the purpose of this group of files..." />
              </Field>
              
              <div className="flex justify-end gap-2 mt-2">
                <Button type="button" onClick={() => setShowCreateModal(false)} variant="ghost">Cancel</Button>
                <Button type="submit" variant="primary" disabled={isPending}>Create</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Asset Modal */}
      {showAddAssetModal && activeCollection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h4 className="text-md font-semibold text-foreground">Add Assets to {activeCollection.name}</h4>
              <button onClick={() => setShowAddAssetModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 flex flex-col gap-2">
              {allAssets
                .filter(asset => !activeCollection.assets?.some(a => a.id === asset.id))
                .map(asset => (
                  <div key={asset.id} className="flex items-center justify-between p-2 rounded hover:bg-muted/40 border border-transparent hover:border-border">
                    <div className="flex items-center gap-3">
                      {getFileIcon(asset.mimeType)}
                      <div>
                        <p className="text-[12px] font-medium text-foreground truncate max-w-[240px]">{asset.title || asset.fileName}</p>
                        <p className="text-[10px] text-muted-foreground uppercase">{asset.mimeType.split("/")[1]}</p>
                      </div>
                    </div>
                    <Button onClick={() => handleAttachAsset(asset.id)} variant="ghost" className="text-primary text-[11px] font-medium py-1 px-2.5 h-auto">
                      Add to Collection
                    </Button>
                  </div>
                ))}

              {allAssets.filter(asset => !activeCollection.assets?.some(a => a.id === asset.id)).length === 0 && (
                <p className="text-center text-[12px] text-muted-foreground py-8">All available assets have been added to this collection.</p>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-border">
              <Button type="button" onClick={() => setShowAddAssetModal(false)} variant="primary">Done</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";
import { useState, useTransition } from "react";
import { Plus, Trash2, Edit3, X, Palette, Type, BookOpen, FileText } from "lucide-react";
import type { BrandKit } from "@/core/domain/entities/brand";
import type { MediaAsset } from "@/core/domain/entities/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { saveBrandKitAction, deleteBrandKitAction, attachAssetToBrandKitAction, detachAssetFromBrandKitAction } from "@/server/actions/media";
import { toast } from "sonner";

interface BrandKitsPanelProps {
  organisationId: string;
  brandKits: BrandKit[];
  allAssets: MediaAsset[];
  signedUrls: Record<string, string>;
}

export function BrandKitsPanel({ organisationId, brandKits, allAssets, signedUrls }: BrandKitsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [activeBrandKit, setActiveBrandKit] = useState<BrandKit | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAttachModal, setShowAttachModal] = useState(false);

  // Form states for Create/Edit Brand Kit
  const [brandKitId, setBrandKitId] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [colors, setColors] = useState<{ name: string; hex: string }[]>([]);
  const [typography, setTypography] = useState<{ name: string; font: string }[]>([]);
  const [toneNotes, setToneNotes] = useState("");
  const [usageGuidance, setUsageGuidance] = useState("");

  // Attach asset form states
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [assetRole, setAssetRole] = useState("logo");

  const startEdit = (bk?: BrandKit) => {
    if (bk) {
      setBrandKitId(bk.id);
      setName(bk.name);
      setColors((bk.colors as { name: string; hex: string }[]) || []);
      setTypography((bk.typography as { name: string; font: string }[]) || []);
      setToneNotes(bk.toneNotes || "");
      setUsageGuidance(bk.usageGuidance || "");
    } else {
      setBrandKitId(undefined);
      setName("");
      setColors([
        { name: "Primary Accent", hex: "#ff6a00" },
        { name: "Secondary", hex: "#080808" }
      ]);
      setTypography([
        { name: "Heading Style", font: "Outfit" },
        { name: "Body Text", font: "Geist" }
      ]);
      setToneNotes("");
      setUsageGuidance("");
    }
    setShowEditModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.append("organisationId", organisationId);
      if (brandKitId) formData.append("brandKitId", brandKitId);
      formData.append("name", name);
      formData.append("colors", JSON.stringify(colors));
      formData.append("typography", JSON.stringify(typography));
      formData.append("toneNotes", toneNotes);
      formData.append("usageGuidance", usageGuidance);

      const result = await saveBrandKitAction({ status: "idle", message: "" }, formData);
      if (result.status === "success") {
        toast.success(result.message);
        setShowEditModal(false);
        if (activeBrandKit && result.resourceId === activeBrandKit.id) {
          // Update details view state
          setActiveBrandKit({
            ...activeBrandKit,
            name,
            colors,
            typography,
            toneNotes,
            usageGuidance
          });
        }
      } else {
        toast.error(result.message);
      }
    });
  };

  const handleDelete = (bkId: string) => {
    if (!confirm("Are you sure you want to delete this brand kit? This action is permanent.")) return;

    startTransition(async () => {
      const result = await deleteBrandKitAction(organisationId, bkId);
      if (result.status === "success") {
        toast.success(result.message);
        if (activeBrandKit?.id === bkId) {
          setActiveBrandKit(null);
        }
      } else {
        toast.error(result.message);
      }
    });
  };

  const handleAttachAsset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBrandKit || !selectedAssetId) return;

    startTransition(async () => {
      const result = await attachAssetToBrandKitAction(activeBrandKit.id, selectedAssetId, assetRole, organisationId);
      if (result.status === "success") {
        toast.success(result.message);
        const asset = allAssets.find(a => a.id === selectedAssetId);
        if (asset && activeBrandKit.assets) {
          setActiveBrandKit({
            ...activeBrandKit,
            assets: [
              ...activeBrandKit.assets,
              {
                brandKitId: activeBrandKit.id,
                assetId: selectedAssetId,
                role: assetRole,
                asset,
                createdAt: new Date().toISOString()
              }
            ]
          });
        }
        setShowAttachModal(false);
        setSelectedAssetId("");
      } else {
        toast.error(result.message);
      }
    });
  };

  const handleDetachAsset = (assetId: string) => {
    if (!activeBrandKit) return;

    startTransition(async () => {
      const result = await detachAssetFromBrandKitAction(activeBrandKit.id, assetId, organisationId);
      if (result.status === "success") {
        toast.success(result.message);
        if (activeBrandKit.assets) {
          setActiveBrandKit({
            ...activeBrandKit,
            assets: activeBrandKit.assets.filter(a => a.assetId !== assetId)
          });
        }
      } else {
        toast.error(result.message);
      }
    });
  };

  const addColor = () => {
    setColors([...colors, { name: "New Swatch", hex: "#999999" }]);
  };

  const removeColor = (index: number) => {
    setColors(colors.filter((_, i) => i !== index));
  };

  const updateColor = (index: number, key: "name" | "hex", value: string) => {
    setColors(colors.map((c, i) => i === index ? { ...c, [key]: value } : c));
  };

  const addFont = () => {
    setTypography([...typography, { name: "Label", font: "Sans" }]);
  };

  const removeFont = (index: number) => {
    setTypography(typography.filter((_, i) => i !== index));
  };

  const updateFont = (index: number, key: "name" | "font", value: string) => {
    setTypography(typography.map((t, i) => i === index ? { ...t, [key]: value } : t));
  };

  return (
    <div className="flex flex-col gap-6">
      {activeBrandKit ? (
        // Detailed Brand Kit view
        <div className="flex flex-col gap-8">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActiveBrandKit(null)}
                className="text-[12px] text-muted-foreground hover:text-foreground hover:underline"
              >
                ← All Brand Kits
              </button>
              <span className="text-muted-foreground">/</span>
              <h3 className="text-lg font-semibold text-foreground">{activeBrandKit.name}</h3>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={() => startEdit(activeBrandKit)} variant="ghost">
                <Edit3 className="size-4" /> Edit Guidelines
              </Button>
              <Button onClick={() => handleDelete(activeBrandKit.id)} variant="ghost" className="text-negative">
                <Trash2 className="size-4" /> Delete Brand Kit
              </Button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Left side: Colors and fonts */}
            <div className="flex flex-col gap-6">
              {/* Colors */}
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
                <h4 className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                  <Palette className="size-4 text-primary" /> Colors & Palette
                </h4>
                <div className="flex flex-wrap gap-4 mt-2">
                  {((activeBrandKit.colors as { name: string; hex: string }[]) || []).map((color, idx) => (
                    <div key={idx} className="flex items-center gap-2.5 bg-muted/40 rounded-md border border-border p-2 min-w-[140px]">
                      <span
                        className="size-7 rounded-md border border-border shrink-0"
                        style={{ backgroundColor: color.hex }}
                      />
                      <div className="flex flex-col truncate">
                        <span className="text-[11px] font-medium text-foreground truncate">{color.name}</span>
                        <span className="text-[10px] text-muted-foreground uppercase font-mono">{color.hex}</span>
                      </div>
                    </div>
                  ))}
                  {(!activeBrandKit.colors || activeBrandKit.colors.length === 0) && (
                    <p className="text-[12px] text-muted-foreground italic">No colors defined in this kit.</p>
                  )}
                </div>
              </div>

              {/* Typography */}
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
                <h4 className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                  <Type className="size-4 text-primary" /> Typography Guidelines
                </h4>
                <div className="flex flex-col gap-2.5 mt-2">
                  {((activeBrandKit.typography as { name: string; font: string }[]) || []).map((font, idx) => (
                    <div key={idx} className="flex justify-between items-center py-2 border-b border-border/40 last:border-b-0">
                      <span className="text-[12px] text-muted-foreground">{font.name}</span>
                      <span className="text-[13px] font-medium text-foreground font-mono">{font.font}</span>
                    </div>
                  ))}
                  {(!activeBrandKit.typography || activeBrandKit.typography.length === 0) && (
                    <p className="text-[12px] text-muted-foreground italic">No typography guidelines defined in this kit.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Right side: Tone and usage notes */}
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5">
                <h4 className="flex items-center gap-2 text-[14px] font-medium text-foreground">
                  <BookOpen className="size-4 text-primary" /> Tone Notes & Usage Guidelines
                </h4>
                <div className="flex flex-col gap-4 mt-2">
                  {activeBrandKit.toneNotes && (
                    <div>
                      <h5 className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Brand Voice / Tone Notes</h5>
                      <p className="mt-1 text-[13px] text-foreground whitespace-pre-line">{activeBrandKit.toneNotes}</p>
                    </div>
                  )}
                  {activeBrandKit.usageGuidance && (
                    <div>
                      <h5 className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">Usage Guidance</h5>
                      <p className="mt-1 text-[13px] text-foreground whitespace-pre-line">{activeBrandKit.usageGuidance}</p>
                    </div>
                  )}
                  {!activeBrandKit.toneNotes && !activeBrandKit.usageGuidance && (
                    <p className="text-[12px] text-muted-foreground italic">No verbal brand guidelines specified.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Attached Brand Assets */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between border-t border-border pt-6">
              <h4 className="text-[14px] font-medium text-foreground">Brand Kit Files & Assets</h4>
              <Button onClick={() => setShowAttachModal(true)} variant="primary">
                Attach Asset
              </Button>
            </div>

            {!activeBrandKit.assets || activeBrandKit.assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-10 text-center">
                <FileText className="size-7 text-muted-foreground" />
                <h5 className="mt-2 text-[13px] font-medium text-foreground">No asset files linked</h5>
                <p className="mt-0.5 text-[11px] text-muted-foreground max-w-xs">
                  Attach logos, templates, wordmarks, or guidelines from your media repository.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
                {activeBrandKit.assets.map((ba) => {
                  const signedUrl = signedUrls[ba.asset?.storagePath || ""];
                  const isImg = ba.asset?.mimeType.startsWith("image/");
                  return (
                    <div key={ba.assetId} className="group relative rounded-lg border border-border bg-card overflow-hidden">
                      <div className="relative aspect-video w-full bg-muted flex items-center justify-center border-b border-border">
                        {isImg && signedUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={signedUrl} alt={ba.asset?.title || ba.asset?.fileName} className="size-full object-cover" />
                        ) : (
                          <FileText className="size-5 text-muted-foreground" />
                        )}
                        <span className="absolute left-2 top-2 rounded bg-black/85 text-[10px] font-mono text-white px-1.5 py-0.5 capitalize shadow-sm">
                          {ba.role}
                        </span>
                        <button
                          onClick={() => handleDetachAsset(ba.assetId)}
                          className="absolute right-2 top-2 rounded bg-black/75 p-1 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-negative"
                          title="Detach asset"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="p-3">
                        <p className="text-[12px] font-medium text-foreground truncate">{ba.asset?.title || ba.asset?.fileName}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        // Grid View of All Brand Kits
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h3 className="text-md font-medium text-foreground">Brand Guidelines & Kits</h3>
            <Button onClick={() => startEdit()} variant="primary">
              <Plus className="size-4" /> New Brand Kit
            </Button>
          </div>

          {brandKits.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-center">
              <Palette className="size-8 text-muted-foreground" />
              <h4 className="mt-3 text-[14px] font-medium text-foreground">No brand kits defined</h4>
              <p className="mt-1 text-[12px] text-muted-foreground max-w-xs">
                Maintain design system consistency. Save brand colors, typography guidelines, and core identity logos.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {brandKits.map((bk) => (
                <div
                  key={bk.id}
                  onClick={() => setActiveBrandKit(bk)}
                  className="group flex flex-col justify-between cursor-pointer rounded-lg border border-border bg-card p-5 transition-colors hover:border-muted-foreground/30"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Palette className="size-5 text-primary" />
                      <h4 className="text-[14px] font-medium text-foreground group-hover:underline">{bk.name}</h4>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(bk.id);
                      }}
                      className="text-muted-foreground hover:text-negative"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>

                  {/* Colors swatches preview */}
                  <div className="flex gap-1.5 mt-3">
                    {((bk.colors as { name: string; hex: string }[]) || []).slice(0, 5).map((color, idx) => (
                      <span
                        key={idx}
                        className="size-5 rounded border border-border shrink-0"
                        style={{ backgroundColor: color.hex }}
                        title={color.name}
                      />
                    ))}
                  </div>

                  <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{bk.assets?.length || 0} core assets</span>
                    <span>Guidelines saved</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Brand Kit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h4 className="text-md font-semibold text-foreground">
                {brandKitId ? `Edit ${name}` : "Create Brand Kit"}
              </h4>
              <button onClick={() => setShowEditModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="flex flex-col gap-6">
              <Field id="bk-name" label="Brand Name" required>
                <Input id="bk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Villiz Pixels Main Brand" required />
              </Field>

              {/* Color Swatch Editor */}
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between items-center">
                  <label className="text-[12px] font-medium text-foreground">Colors Palette</label>
                  <button type="button" onClick={addColor} className="text-[11px] text-primary hover:underline">+ Add Color</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {colors.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 border border-border rounded p-1.5 bg-muted/20">
                      <input
                        type="color"
                        value={c.hex}
                        onChange={(e) => updateColor(i, "hex", e.target.value)}
                        className="size-6 rounded border cursor-pointer bg-transparent"
                      />
                      <Input
                        value={c.name}
                        onChange={(e) => updateColor(i, "name", e.target.value)}
                        placeholder="Label"
                        className="h-7 text-[12px]"
                      />
                      <button type="button" onClick={() => removeColor(i)} className="text-negative hover:bg-muted p-1 rounded shrink-0">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Font pairing Editor */}
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-between items-center">
                  <label className="text-[12px] font-medium text-foreground">Typography Pairings</label>
                  <button type="button" onClick={addFont} className="text-[11px] text-primary hover:underline">+ Add Font</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {typography.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 border border-border rounded p-1.5 bg-muted/20">
                      <Input
                        value={t.name}
                        onChange={(e) => updateFont(i, "name", e.target.value)}
                        placeholder="Label (e.g. Heading)"
                        className="h-7 text-[12px] w-28 shrink-0"
                      />
                      <Input
                        value={t.font}
                        onChange={(e) => updateFont(i, "font", e.target.value)}
                        placeholder="Font (e.g. Outfit)"
                        className="h-7 text-[12px]"
                      />
                      <button type="button" onClick={() => removeFont(i)} className="text-negative hover:bg-muted p-1 rounded shrink-0">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="bk-tone" label="Brand Voice & Tone Notes">
                  <Textarea id="bk-tone" value={toneNotes} onChange={(e) => setToneNotes(e.target.value)} placeholder="Warm, direct, clean. No hyperbole..." className="h-28" />
                </Field>
                <Field id="bk-usage" label="Usage & Design Guidance">
                  <Textarea id="bk-usage" value={usageGuidance} onChange={(e) => setUsageGuidance(e.target.value)} placeholder="Use primary accents on buttons, keep margins airy..." className="h-28" />
                </Field>
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-4">
                <Button type="button" onClick={() => setShowEditModal(false)} variant="ghost">Cancel</Button>
                <Button type="submit" variant="primary" disabled={isPending}>Save brand kit</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Attach Asset Modal */}
      {showAttachModal && activeBrandKit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h4 className="text-md font-semibold text-foreground">Link Identity File</h4>
              <button onClick={() => setShowAttachModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleAttachAsset} className="flex flex-col gap-4">
              <Field id="attach-asset" label="Select File from Media Library" required>
                <select
                  id="attach-asset"
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-[13px] focus:outline-none focus:border-primary"
                  required
                >
                  <option value="">Choose an asset...</option>
                  {allAssets
                    .filter(asset => !activeBrandKit.assets?.some(ba => ba.assetId === asset.id))
                    .map(asset => (
                      <option key={asset.id} value={asset.id}>
                        {asset.title || asset.fileName} ({asset.mimeType.split("/")[1]})
                      </option>
                    ))}
                </select>
              </Field>

              <Field id="attach-role" label="Asset Role (branding classification)">
                <select
                  id="attach-role"
                  value={assetRole}
                  onChange={(e) => setAssetRole(e.target.value)}
                  className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-[13px] focus:outline-none focus:border-primary"
                >
                  <option value="logo">Primary Logo</option>
                  <option value="wordmark">Wordmark</option>
                  <option value="icon">Favicon / Icon</option>
                  <option value="template">Layout Template</option>
                  <option value="colorway">Colorway Visual</option>
                  <option value="other">Other Identity Asset</option>
                </select>
              </Field>

              <div className="flex justify-end gap-2 mt-2">
                <Button type="button" onClick={() => setShowAttachModal(false)} variant="ghost">Cancel</Button>
                <Button type="submit" variant="primary" disabled={isPending || !selectedAssetId}>Attach asset</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

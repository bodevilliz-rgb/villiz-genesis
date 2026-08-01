import { Linkedin, Facebook, Instagram, X as XIcon, type LucideIcon } from "lucide-react";
import { PUBLISHING_PLATFORM_LABELS, type PublishingPlatform } from "@/core/domain/entities/publishing";
import { cn } from "@/lib/utils";

const PLATFORM_ICONS: Record<PublishingPlatform, LucideIcon> = {
  linkedin: Linkedin,
  facebook: Facebook,
  instagram: Instagram,
  x: XIcon,
};

/**
 * Brand colours, not semantic status tones — deliberately not drawn from the
 * app's `text-positive`/`text-danger`/etc. palette. Chosen for contrast
 * against both the light and dark card backgrounds already in use
 * (`bg-card`/`bg-muted`), not just against white.
 */
const PLATFORM_COLORS: Record<PublishingPlatform, string> = {
  linkedin: "text-[#0A66C2]",
  facebook: "text-[#1877F2]",
  instagram: "text-[#E1306C]",
  x: "text-foreground",
};

/**
 * The one reusable place a publishing platform is rendered — icon, label,
 * and accessible name all come from here so every surface (queue card, job
 * detail, Dashboard, Content Studio, Calendar, audit trail) stays visually
 * and semantically consistent. Always reflects `PublishingJob.platform` —
 * callers must never infer a platform from a draft's title, content type,
 * or campaign.
 */
export function PlatformBadge({
  platform,
  size = "md",
  showLabel = true,
  className,
}: {
  platform: PublishingPlatform;
  size?: "sm" | "md";
  /** false renders an icon-only badge (e.g. a calendar day cell) — accessible name moves onto the badge itself instead of visible text. */
  showLabel?: boolean;
  className?: string;
}) {
  const Icon = PLATFORM_ICONS[platform];
  const label = PUBLISHING_PLATFORM_LABELS[platform];

  return (
    <span
      role="img"
      aria-label={`Publishing destination: ${label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-muted-foreground",
        size === "sm" ? "text-[11px]" : "text-[12px]",
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn(PLATFORM_COLORS[platform], size === "sm" ? "size-3" : "size-3.5")} />
      {showLabel ? <span aria-hidden="true">{label}</span> : null}
    </span>
  );
}

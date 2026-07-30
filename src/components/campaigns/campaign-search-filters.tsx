"use client";
import { useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_PLATFORM_LABELS, CAMPAIGN_STATUS_LABELS } from "@/core/domain/entities/campaign";

/** Search state lives in the URL — mirrors MemBrain's and Content Studio's SearchFilters exactly. */
export function CampaignSearchFilters({
  defaults,
}: {
  defaults: { q?: string; status?: string; platform?: string };
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} method="get" className="flex flex-wrap items-end gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground"
        />
        <Input
          name="q"
          defaultValue={defaults.q ?? ""}
          placeholder="Search campaigns by name or objective"
          aria-label="Search campaigns"
          className="pl-9"
        />
      </div>

      <Select
        name="status"
        defaultValue={defaults.status ?? ""}
        aria-label="Filter by status"
        className="w-40"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">Any status</option>
        {Object.entries(CAMPAIGN_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>

      <Select
        name="platform"
        defaultValue={defaults.platform ?? ""}
        aria-label="Filter by platform"
        className="w-40"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">Any platform</option>
        {Object.entries(CAMPAIGN_PLATFORM_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>

      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

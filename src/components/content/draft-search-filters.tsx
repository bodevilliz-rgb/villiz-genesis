"use client";
import { useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CONTENT_DRAFT_STATUS_LABELS, CONTENT_DRAFT_TYPE_LABELS } from "@/core/domain/entities/content";
import type { OrganisationMember } from "@/core/domain/entities/organisation";

/**
 * Search state lives in the URL, exactly like MemBrain's SearchFilters —
 * shareable, survivable across a refresh, and rendered on the server so the
 * draft list and this form are never a different filtered view of the truth.
 */
export function DraftSearchFilters({
  members,
  defaults,
}: {
  members: OrganisationMember[];
  defaults: { q?: string; status?: string; type?: string; author?: string };
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
          placeholder="Search drafts by title"
          aria-label="Search drafts"
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
        {Object.entries(CONTENT_DRAFT_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>

      <Select
        name="type"
        defaultValue={defaults.type ?? ""}
        aria-label="Filter by content type"
        className="w-40"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">Any type</option>
        {Object.entries(CONTENT_DRAFT_TYPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>

      <Select
        name="author"
        defaultValue={defaults.author ?? ""}
        aria-label="Filter by author"
        className="w-44"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">Anyone</option>
        {members.map((member) => (
          <option key={member.profileId} value={member.profileId}>
            {member.profile.fullName ?? member.profile.email}
          </option>
        ))}
      </Select>

      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

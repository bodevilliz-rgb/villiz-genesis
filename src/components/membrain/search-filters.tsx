"use client";
import { useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { MembrainCategory } from "@/core/domain/entities/membrain";
import { MEMBRAIN_STATUS_LABELS } from "@/core/domain/entities/membrain";

/**
 * Search state lives in the URL, not in React.
 *
 * That makes any result set shareable with a colleague, survivable across a
 * refresh, and rendered on the server — which matters because the ranking is
 * done by Postgres and we never want a second, divergent client-side filter.
 */
export function SearchFilters({
  categories,
  defaults,
}: {
  categories: MembrainCategory[];
  defaults: { q?: string; category?: string; status?: string };
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
          placeholder="Search this client's knowledge"
          aria-label="Search MemBrain"
          className="pl-9"
        />
      </div>

      <Select
        name="category"
        defaultValue={defaults.category ?? ""}
        aria-label="Filter by category"
        className="w-44"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
      </Select>

      <Select
        name="status"
        defaultValue={defaults.status ?? "active"}
        aria-label="Filter by status"
        className="w-36"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">Any status</option>
        {Object.entries(MEMBRAIN_STATUS_LABELS).map(([value, label]) => (
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

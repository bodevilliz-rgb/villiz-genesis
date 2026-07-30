"use client";
import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

/**
 * Tags are posted as a single comma-separated hidden field so the whole form
 * remains a plain FormData submission to a Server Action — no client-side JSON
 * bridge, and the form still works while JavaScript is loading.
 */
export function TagInput({
  name,
  defaultTags = [],
  suggestions = [],
}: {
  name: string;
  defaultTags?: string[];
  suggestions?: string[];
}) {
  const [tags, setTags] = useState<string[]>(defaultTags);
  const [draft, setDraft] = useState("");

  const add = (value: string) => {
    const trimmed = value.trim().replace(/,/g, "");
    if (!trimmed) return;
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
    if (tags.length >= 20) return;
    setTags([...tags, trimmed]);
    setDraft("");
  };

  const remove = (value: string) => setTags(tags.filter((t) => t !== value));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  };

  const unused = suggestions.filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase())).slice(0, 8);

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={tags.join(",")} />

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} tone="accent" className="pr-1">
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove tag ${tag}`}
                className="rounded-full p-0.5 transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => add(draft)}
        placeholder="Type a tag and press Enter"
        aria-label="Add a tag"
      />

      {unused.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-subtle-foreground">Used before:</span>
          {unused.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => add(suggestion)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createEntryAction, updateEntryAction } from "@/server/actions/membrain";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/common/form-message";
import { TagInput } from "./tag-input";
import {
  ALWAYS_IN_CONTEXT_THRESHOLD,
  IMPORTANCE_LABELS,
  MEMBRAIN_SOURCE_LABELS,
  MEMBRAIN_STATUS_LABELS,
  type MembrainCategory,
  type MembrainEntry,
} from "@/core/domain/entities/membrain";
import { routes } from "@/lib/routes";

export function EntryForm({
  organisationId,
  categories,
  tagSuggestions,
  entry,
}: {
  organisationId: string;
  categories: MembrainCategory[];
  tagSuggestions: string[];
  entry?: MembrainEntry;
}) {
  const isEdit = Boolean(entry);
  const router = useRouter();
  const [state, formAction] = useActionState(isEdit ? updateEntryAction : createEntryAction, idleState);

  useEffect(() => {
    if (state.status === "success" && state.resourceId) {
      toast.success(state.message);
      router.push(routes.organisations.membrain.entry(organisationId, state.resourceId));
    }
  }, [state, organisationId, router]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="organisationId" value={organisationId} />
      {entry ? <input type="hidden" name="id" value={entry.id} /> : null}

      <Field id="title" label="What is this?" errors={state.fieldErrors?.title} required>
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          defaultValue={entry?.title}
          placeholder="Never use the word &quot;cheap&quot; — we say &quot;accessible&quot;"
          aria-invalid={Boolean(state.fieldErrors?.title)}
        />
      </Field>

      <Field
        id="summary"
        label="One-line summary"
        hint="Optional · shown in search results"
        errors={state.fieldErrors?.summary}
      >
        <Input id="summary" name="summary" maxLength={500} defaultValue={entry?.summary ?? ""} />
      </Field>

      <Field
        id="body"
        label="The knowledge"
        hint="This exact text is what AI features read"
        errors={state.fieldErrors?.body}
        required
      >
        <Textarea
          id="body"
          name="body"
          required
          rows={12}
          maxLength={50000}
          defaultValue={entry?.body}
          placeholder={"Write it the way you would explain it to a new starter.\n\nBe specific. Include examples of what to do and what not to do — the model follows concrete instructions far better than abstract ones."}
          className="knowledge-body"
          aria-invalid={Boolean(state.fieldErrors?.body)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="categoryId" label="Category" errors={state.fieldErrors?.categoryId}>
          <Select id="categoryId" name="categoryId" defaultValue={entry?.categoryId ?? ""}>
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="importance"
          label="Importance"
          hint={`${ALWAYS_IN_CONTEXT_THRESHOLD}+ is always sent to AI`}
          errors={state.fieldErrors?.importance}
        >
          <Select id="importance" name="importance" defaultValue={String(entry?.importance ?? 3)}>
            {Object.entries(IMPORTANCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {value} · {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="source" label="Where it came from" errors={state.fieldErrors?.source}>
          <Select id="source" name="source" defaultValue={entry?.source ?? "manual"}>
            {Object.entries(MEMBRAIN_SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="status" label="Status" hint="Only active entries reach AI" errors={state.fieldErrors?.status}>
          <Select id="status" name="status" defaultValue={entry?.status ?? "active"}>
            {Object.entries(MEMBRAIN_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="sourceUrl"
          label="Source link"
          hint="Optional"
          errors={state.fieldErrors?.sourceUrl}
          className="sm:col-span-2"
        >
          <Input
            id="sourceUrl"
            name="sourceUrl"
            type="url"
            defaultValue={entry?.sourceUrl ?? ""}
            placeholder="https://"
            aria-invalid={Boolean(state.fieldErrors?.sourceUrl)}
          />
        </Field>

        <div className="sm:col-span-2">
          <p className="mb-1.5 text-[13px] font-medium">Tags</p>
          <TagInput name="tags" defaultTags={entry?.tags.map((t) => t.name) ?? []} suggestions={tagSuggestions} />
        </div>
      </div>

      {isEdit ? (
        <Field
          id="changeSummary"
          label="What changed?"
          hint="Optional · recorded permanently against this version"
          errors={state.fieldErrors?.changeSummary}
        >
          <Input
            id="changeSummary"
            name="changeSummary"
            maxLength={280}
            placeholder="Tightened the voice rules after the January review"
          />
        </Field>
      ) : null}

      <FormMessage state={state} />

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel={isEdit ? "Saving…" : "Adding…"}>
          {isEdit ? "Save new version" : "Add to MemBrain"}
        </SubmitButton>
        <Button asChild variant="ghost">
          <a
            href={
              entry
                ? routes.organisations.membrain.entry(organisationId, entry.id)
                : routes.organisations.membrain.index(organisationId)
            }
          >
            Cancel
          </a>
        </Button>
      </div>
    </form>
  );
}

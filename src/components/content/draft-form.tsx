"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { createDraftAction, updateDraftAction } from "@/server/actions/content";
import { idleState } from "@/server/action-result";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/common/form-message";
import { CONTENT_DRAFT_TYPE_LABELS, type ContentDraft } from "@/core/domain/entities/content";
import type { MembrainCategory } from "@/core/domain/entities/membrain";
import type { Campaign } from "@/core/domain/entities/campaign";
import { routes } from "@/lib/routes";

const AUTOSAVE_DEBOUNCE_MS = 2000;
const SAVED_INDICATOR_MS = 4000;

type SaveState = "idle" | "dirty" | "saving" | "saved";

function AutosaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;

  return (
    <p className="flex items-center gap-1.5 text-[12px] text-subtle-foreground" role="status" aria-live="polite">
      {state === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Saving…
        </>
      ) : state === "saved" ? (
        <>
          <Check className="size-3.5 text-positive" aria-hidden />
          Saved just now
        </>
      ) : (
        "Unsaved changes"
      )}
    </p>
  );
}

/**
 * A document, not a chat window: the title and body dominate the layout, and
 * the metadata that describes the document (type, content pillar, summary)
 * sits below it as a compact secondary row — never above the body, never in
 * a modal.
 *
 * Edit mode autosaves on a debounce. Autosave deliberately skips the success
 * toast and the router.refresh() the explicit Save button triggers — a
 * refresh replays every Server Component data fetch on this page (draft,
 * categories, generation request, and the full generation-readiness bundle —
 * Context Engine, Knowledge/Campaign resolvers, Draft Analyser, Confidence
 * Engine) on every debounce tick, which would make typing feel heavy. The version
 * number in the page header simply lags behind until the next explicit
 * Save or navigation; that's a deliberate tradeoff, not an oversight — see
 * the Sprint 3.1 report's performance considerations.
 */
export function DraftForm({
  organisationId,
  categories,
  campaigns,
  draft,
  locked = false,
}: {
  organisationId: string;
  categories: MembrainCategory[];
  campaigns: Campaign[];
  draft?: ContentDraft;
  /** True once a draft is approved or rejected — see isContentDraftLocked. Disables every field until a Lead reopens the review. */
  locked?: boolean;
}) {
  const isEdit = Boolean(draft);
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(isEdit ? updateDraftAction : createDraftAction, idleState);

  const formRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlightRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const saveState: SaveState = isPending ? "saving" : justSaved ? "saved" : dirty ? "dirty" : "idle";

  function scheduleAutosave() {
    if (!isEdit || locked) return;
    setDirty(true);
    setJustSaved(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!formRef.current) return;
      autosaveInFlightRef.current = true;
      // Excluded so a reason typed but not yet meant to be submitted never
      // gets attached to an autosave the writer didn't ask for — see the
      // "not sent by autosave" hint on the field itself.
      const formData = new FormData(formRef.current);
      formData.delete("changeSummary");
      formAction(formData);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    if (state.status === "idle") return;

    if (state.status === "success" && state.resourceId) {
      if (!isEdit) {
        toast.success(state.message);
        router.push(routes.organisations.content.draft(organisationId, state.resourceId));
        return;
      }

      setDirty(false);
      if (autosaveInFlightRef.current) {
        setJustSaved(true);
        if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
        savedTimeoutRef.current = setTimeout(() => setJustSaved(false), SAVED_INDICATOR_MS);
      } else {
        toast.success(state.message);
        router.refresh();
      }
    } else if (state.status === "error") {
      toast.error(state.message);
      setDirty(true);
    }

    autosaveInFlightRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  return (
    <form
      ref={formRef}
      action={formAction}
      onInput={scheduleAutosave}
      onSubmit={() => {
        // An explicit Save always wins over a pending autosave debounce.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        autosaveInFlightRef.current = false;
      }}
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="organisationId" value={organisationId} />
      {draft ? <input type="hidden" name="id" value={draft.id} /> : null}

      {locked ? (
        <p className="rounded-md border border-border-strong bg-muted px-3 py-2 text-[12px] text-muted-foreground">
          This draft is locked because it has been {draft?.status === "rejected" ? "rejected" : "approved"}. A Lead
          must reopen the review before it can be edited.
        </p>
      ) : null}

      <Field id="title" label="Title" errors={state.fieldErrors?.title} required>
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          defaultValue={draft?.title}
          placeholder="Spring promotion — new patient welcome email"
          aria-invalid={Boolean(state.fieldErrors?.title)}
          className="text-base font-medium"
          disabled={locked}
        />
      </Field>

      {isEdit ? <AutosaveIndicator state={saveState} /> : null}

      <Field id="body" label="The draft" hint="Write it as it should appear" errors={state.fieldErrors?.body}>
        <Textarea
          id="body"
          name="body"
          rows={16}
          maxLength={50000}
          defaultValue={draft?.body}
          placeholder="Start writing, or use the generation request alongside this document to bring in what MemBrain already knows about this client."
          className="knowledge-body"
          aria-invalid={Boolean(state.fieldErrors?.body)}
          disabled={locked}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contentType" label="Content type" errors={state.fieldErrors?.contentType}>
          <Select id="contentType" name="contentType" defaultValue={draft?.contentType ?? "social_post"} disabled={locked}>
            {Object.entries(CONTENT_DRAFT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="categoryId" label="Content pillar" errors={state.fieldErrors?.categoryId}>
          <Select id="categoryId" name="categoryId" defaultValue={draft?.category?.id ?? ""} disabled={locked}>
            <option value="">None</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="campaignId" label="Campaign" hint="Optional" errors={state.fieldErrors?.campaignId}>
          <Select id="campaignId" name="campaignId" defaultValue={draft?.campaign?.id ?? ""} disabled={locked}>
            <option value="">No campaign</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="summary"
          label="One-line summary"
          hint="Optional"
          errors={state.fieldErrors?.summary}
          className="sm:col-span-2"
        >
          <Input id="summary" name="summary" maxLength={500} defaultValue={draft?.summary ?? ""} disabled={locked} />
        </Field>
      </div>

      {isEdit ? (
        <Field
          id="changeSummary"
          label="What changed?"
          hint="Optional · recorded permanently against this version · not sent by autosave"
          errors={state.fieldErrors?.changeSummary}
        >
          <Input
            id="changeSummary"
            name="changeSummary"
            maxLength={280}
            placeholder="Tightened the CTA after the client call"
            disabled={locked}
          />
        </Field>
      ) : null}

      <FormMessage state={state} />

      <div className="flex items-center gap-3">
        {locked ? (
          // A plain disabled Button, not SubmitButton — SubmitButton spreads
          // its own props after `disabled={pending}`, so passing `disabled`
          // through it here would fight (and sometimes lose to) that pending
          // state instead of cleanly overriding it.
          <Button type="button" disabled>
            {isEdit ? "Save" : "Create draft"}
          </Button>
        ) : (
          <SubmitButton pendingLabel={isEdit ? "Saving…" : "Creating…"}>
            {isEdit ? "Save" : "Create draft"}
          </SubmitButton>
        )}
        {isEdit ? (
          <Button asChild variant="ghost">
            <a href={routes.organisations.content.index(organisationId)}>Back to Content Studio</a>
          </Button>
        ) : (
          <Button asChild variant="ghost">
            <a href={routes.organisations.content.index(organisationId)}>Cancel</a>
          </Button>
        )}
      </div>
    </form>
  );
}

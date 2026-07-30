"use client";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Sparkles } from "lucide-react";
import { previewContextAction } from "@/server/actions/membrain";
import { idleState } from "@/server/action-result";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";
import { FormMessage } from "@/components/common/form-message";
import { formatNumber } from "@/lib/format";

type ContextState = typeof idleState & { prompt?: string; tokens?: number; entries?: number };

/**
 * Shows exactly what an AI feature will be told about this client, before any
 * content is generated.
 *
 * This is the trust mechanism for the whole product. A strategist can verify
 * that the model is working from correct, current knowledge — and can see when
 * it is not — rather than discovering it in a draft the client rejects.
 */
export function ContextInspector({ organisationId }: { organisationId: string }) {
  const [state, formAction] = useActionState<ContextState, FormData>(previewContextAction, idleState);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.status === "error") toast.error(state.message);
  }, [state]);

  const copy = async () => {
    if (!state.prompt) return;
    await navigator.clipboard.writeText(state.prompt);
    setCopied(true);
    toast.success("Context copied.");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="organisationId" value={organisationId} />
        <div className="min-w-[220px] flex-1">
          <Input
            name="query"
            placeholder="What is the AI about to work on? e.g. spring promotion for new patients"
            aria-label="Retrieval query"
          />
        </div>
        <SubmitButton pendingLabel="Assembling…">
          <Sparkles aria-hidden />
          Assemble context
        </SubmitButton>
      </form>

      <FormMessage state={state} />

      {state.prompt ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{formatNumber(state.entries ?? 0)} entries selected</Badge>
            <Badge tone="muted">~{formatNumber(state.tokens ?? 0)} tokens</Badge>
            <Button type="button" variant="ghost" size="sm" onClick={copy} className="ml-auto">
              <Copy aria-hidden />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
            {state.prompt}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

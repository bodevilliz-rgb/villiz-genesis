import Link from "next/link";
import { Brain, CheckCircle2, FilePlus2, Megaphone, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { routes } from "@/lib/routes";

/**
 * "New Campaign", "New Draft" and "MemBrain" are org-scoped destinations —
 * every one of them lives under /organisations/[orgId]/... — so a global,
 * cross-account dashboard can't deep-link into them without picking an
 * account first. Rather than forcing an extra click through /organisations
 * every time, these jump straight to the actor's most-recently-updated
 * account (the one they were most likely just working in); with no visible
 * accounts at all, they're disabled instead of linking nowhere.
 */
export function QuickActions({ defaultOrganisationId }: { defaultOrganisationId: string | null }) {
  const disabled = !defaultOrganisationId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
        <CardDescription>Jump straight into the account you were last working in.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild={!disabled} variant="secondary" size="sm" disabled={disabled}>
          {disabled ? (
            <span>
              <Megaphone aria-hidden />
              New campaign
            </span>
          ) : (
            <Link href={routes.organisations.campaigns.new(defaultOrganisationId)}>
              <Megaphone aria-hidden />
              New campaign
            </Link>
          )}
        </Button>

        <Button asChild={!disabled} variant="secondary" size="sm" disabled={disabled}>
          {disabled ? (
            <span>
              <FilePlus2 aria-hidden />
              New draft
            </span>
          ) : (
            <Link href={routes.organisations.content.new(defaultOrganisationId)}>
              <FilePlus2 aria-hidden />
              New draft
            </Link>
          )}
        </Button>

        <Button asChild={!disabled} variant="secondary" size="sm" disabled={disabled}>
          {disabled ? (
            <span>
              <Brain aria-hidden />
              MemBrain
            </span>
          ) : (
            <Link href={routes.organisations.membrain.index(defaultOrganisationId)}>
              <Brain aria-hidden />
              MemBrain
            </Link>
          )}
        </Button>

        <Button asChild variant="secondary" size="sm">
          <Link href={routes.review}>
            <CheckCircle2 aria-hidden />
            Review queue
          </Link>
        </Button>

        <Button variant="secondary" size="sm" disabled title="Publishing is not yet built in Genesis">
          <Send aria-hidden />
          Publishing queue
        </Button>
      </CardContent>
    </Card>
  );
}

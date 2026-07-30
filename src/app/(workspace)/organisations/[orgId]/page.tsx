import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, Brain, Plus } from "lucide-react";
import { requireContext } from "@/server/container";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { UsageMeter } from "@/components/common/usage-meter";
import { MembrainStatusBadge } from "@/components/common/status-badge";
import { toUsageMetrics } from "@/core/domain/entities/usage";
import { importanceLabel, MEMBRAIN_SOURCE_LABELS } from "@/core/domain/entities/membrain";
import { formatDate, formatRelative } from "@/lib/format";
import { routes } from "@/lib/routes";

export default async function OrganisationOverviewPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const context = await requireContext();

  const [organisation, usage, recent, members] = await Promise.all([
    context.organisations.findById(orgId),
    context.usage.forOrganisation(orgId),
    context.membrain.listRecent(orgId, 5),
    context.organisations.listMembers(orgId),
  ]);

  if (!organisation) notFound();
  const metrics = usage ? toUsageMetrics(usage) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent knowledge</CardTitle>
              <CardDescription>The last things we learned about this client.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href={routes.organisations.membrain.index(orgId)}>
                Open MemBrain
                <ArrowUpRight aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className={recent.length === 0 ? "py-6" : "p-0"}>
            {recent.length === 0 ? (
              <EmptyState
                className="border-0 py-4"
                icon={<Brain aria-hidden />}
                title="MemBrain is empty"
                description="Everything the team knows about this client goes here — voice, audience, rules, what works. It is what every AI feature reads from."
                action={
                  <Button asChild variant="primary" size="sm">
                    <Link href={routes.organisations.membrain.new(orgId)}>
                      <Plus aria-hidden />
                      Add the first entry
                    </Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      href={routes.organisations.membrain.entry(orgId, entry.id)}
                      className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-card-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{entry.title}</span>
                        <span className="block truncate text-[12px] text-subtle-foreground">
                          {entry.category?.label ?? "Uncategorised"} · {importanceLabel(entry.importance)} · v
                          {entry.version} · {formatRelative(entry.updatedAt)}
                        </span>
                      </span>
                      <MembrainStatusBadge status={entry.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account record</CardTitle>
            <CardDescription>Internal detail. Never shared with the client.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Detail label="Registered name" value={organisation.legalName} />
            <Detail label="Industry" value={organisation.industry} />
            <Detail label="Main contact" value={organisation.primaryContactName} />
            <Detail label="Contact email" value={organisation.primaryContactEmail} />
            <Detail label="Onboarded" value={organisation.onboardedAt ? formatDate(organisation.onboardedAt) : null} />
            <Detail label="Reference" value={organisation.slug} mono />
            {organisation.notes ? (
              <div className="sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wider text-subtle-foreground">Notes</p>
                <p className="knowledge-body mt-1 text-[13px] text-muted-foreground">{organisation.notes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Guardrails</CardTitle>
            <CardDescription>What this account is allowed to consume.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {metrics.map((metric) => (
              <UsageMeter key={metric.key} metric={metric} />
            ))}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Team</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href={routes.organisations.team(orgId)}>Manage</Link>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {members.length === 0 ? (
              <p className="text-[13px] text-subtle-foreground">Nobody is assigned to this account.</p>
            ) : (
              members.map((member) => (
                <div key={member.profileId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px]">
                    {member.profile.fullName ?? member.profile.email}
                  </span>
                  <Badge tone={member.role === "lead" ? "accent" : "muted"}>{member.role}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Where knowledge comes from</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {Object.values(MEMBRAIN_SOURCE_LABELS).map((label) => (
              <Badge key={label} tone="muted">
                {label}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-subtle-foreground">{label}</p>
      <p className={`mt-0.5 text-[13px] ${mono ? "font-mono" : ""} ${value ? "" : "text-subtle-foreground"}`}>
        {value ?? "Not set"}
      </p>
    </div>
  );
}

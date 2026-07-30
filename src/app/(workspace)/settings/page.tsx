import type { Metadata } from "next";
import { requireContext } from "@/server/container";
import { PageHeader } from "@/components/common/page-header";
import { ProfileForm } from "@/components/common/profile-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_ROLE_LABELS } from "@/core/domain/entities/identity";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const context = await requireContext();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="Your profile" description="How you appear to the rest of the Villiz team." />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Your email is managed by sign-in and cannot be changed here.</CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <ProfileForm actor={context.actor} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
          <CardDescription>Set by platform administrators.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Email</span>
            <span className="font-mono text-[12px]">{context.actor.email}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Platform role</span>
            <Badge tone={context.actor.isPlatformAdmin ? "accent" : "muted"}>
              {PLATFORM_ROLE_LABELS[context.actor.role]}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Member since</span>
            <span>{formatDate(context.actor.createdAt)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

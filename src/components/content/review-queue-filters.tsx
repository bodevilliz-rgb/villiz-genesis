"use client";
import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { OrganisationMember, OrganisationSummary } from "@/core/domain/entities/organisation";
import type { Campaign } from "@/core/domain/entities/campaign";
import type { EligibleReviewer } from "@/core/application/use-cases/review";

/**
 * Campaign, author and reviewer only make sense once one account is
 * selected — a cross-account name search would either fetch every campaign
 * and every member across every account the actor can see (a request with
 * no natural bound) or silently only match one account's people while
 * looking like a portfolio-wide filter. Rather than either, those three
 * selects stay disabled with an explanatory placeholder until an account is
 * chosen — organisation and the date range remain the only filters that
 * are always available.
 */
export function ReviewQueueFilters({
  tab,
  organisations,
  campaigns,
  members,
  reviewers,
  showReviewerFilter,
  defaults,
}: {
  tab: string;
  organisations: OrganisationSummary[];
  campaigns: Campaign[];
  members: OrganisationMember[];
  reviewers: EligibleReviewer[];
  showReviewerFilter: boolean;
  defaults: {
    organisationId?: string;
    campaignId?: string;
    authorId?: string;
    reviewerId?: string;
    from?: string;
    to?: string;
  };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const hasOrganisation = Boolean(defaults.organisationId);

  return (
    <form ref={formRef} method="get" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tab" value={tab} />

      <Select
        name="organisationId"
        defaultValue={defaults.organisationId ?? ""}
        aria-label="Filter by account"
        className="w-48"
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">Every account</option>
        {organisations.map((organisation) => (
          <option key={organisation.id} value={organisation.id}>
            {organisation.name}
          </option>
        ))}
      </Select>

      <Select
        name="campaignId"
        defaultValue={defaults.campaignId ?? ""}
        aria-label="Filter by campaign"
        className="w-44"
        disabled={!hasOrganisation}
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">{hasOrganisation ? "Any campaign" : "Choose an account first"}</option>
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </Select>

      <Select
        name="authorId"
        defaultValue={defaults.authorId ?? ""}
        aria-label="Filter by author"
        className="w-44"
        disabled={!hasOrganisation}
        onChange={() => formRef.current?.requestSubmit()}
      >
        <option value="">{hasOrganisation ? "Any author" : "Choose an account first"}</option>
        {members.map((member) => (
          <option key={member.profileId} value={member.profileId}>
            {member.profile.fullName ?? member.profile.email}
          </option>
        ))}
      </Select>

      {showReviewerFilter ? (
        <Select
          name="reviewerId"
          defaultValue={defaults.reviewerId ?? ""}
          aria-label="Filter by reviewer"
          className="w-44"
          disabled={!hasOrganisation}
          onChange={() => formRef.current?.requestSubmit()}
        >
          <option value="">{hasOrganisation ? "Any reviewer" : "Choose an account first"}</option>
          {reviewers.map((reviewer) => (
            <option key={reviewer.id} value={reviewer.id}>
              {reviewer.fullName ?? reviewer.email}
            </option>
          ))}
        </Select>
      ) : null}

      <Input type="date" name="from" defaultValue={defaults.from ?? ""} aria-label="Updated from" className="w-36" />
      <Input type="date" name="to" defaultValue={defaults.to ?? ""} aria-label="Updated to" className="w-36" />

      <Button type="submit" variant="secondary">
        Filter
      </Button>
    </form>
  );
}

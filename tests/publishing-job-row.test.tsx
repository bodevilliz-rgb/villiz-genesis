// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublishingJobRow } from "@/components/publishing/publishing-job-row";
import type { PublishingAttempt, PublishingJob } from "@/core/domain/entities/publishing";

const ORG_ID = "00000000-0000-4000-8000-000000000001";

function job(overrides: Partial<PublishingJob> = {}): PublishingJob {
  return {
    id: "job-1",
    organisationId: ORG_ID,
    draftId: "draft-1",
    platform: "linkedin",
    triggerType: "immediate",
    scheduledFor: "2026-08-01T10:00:00.000Z",
    status: "published",
    idempotencyKey: "key-1",
    requestedBy: "actor-1",
    requestedByProfile: { id: "actor-1", fullName: "Bode Villiz", email: "bode@villiz.com" },
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:05.000Z",
    claimedBy: "worker-1",
    nextAttemptAt: null,
    retryCount: 0,
    maxRetries: 3,
    completedAt: "2026-08-01T10:00:05.000Z",
    cancelledAt: null,
    devSimulationMode: null,
    resolvedAccountId: null,
    isAiGenerated: null,
    isYourBrand: null,
    isBrandedContent: null,
    executionMode: "simulation",
    ...overrides,
  };
}

function attempt(overrides: Partial<PublishingAttempt> = {}): PublishingAttempt {
  return {
    id: "attempt-1",
    jobId: "job-1",
    organisationId: ORG_ID,
    draftId: "draft-1",
    platform: "linkedin",
    attemptNumber: 1,
    status: "completed",
    queuedAt: "2026-08-01T10:00:00.000Z",
    startedAt: "2026-08-01T10:00:01.000Z",
    completedAt: "2026-08-01T10:00:05.000Z",
    failedAt: null,
    durationMs: 4000,
    externalPostId: "mock-linkedin-1",
    externalUrl: "https://mock.local/linkedin/mock-linkedin-1",
    errorCode: null,
    errorMessage: null,
    retryOfAttemptId: null,
    providerMetadata: {},
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("PublishingJobRow — platform consistency", () => {
  it("shows the platform from the job record, never inferred from the draft title", () => {
    render(
      <PublishingJobRow
        organisationId={ORG_ID}
        job={job({ platform: "linkedin" })}
        draftTitle="Instagram Promo Post"
        campaign={null}
        organisationName="Villiz Pixels"
        attempts={[attempt()]}
        canWrite={true}
      />,
    );

    // The exact scenario the mission calls out: an Instagram-titled draft published to LinkedIn.
    expect(screen.getByText("Instagram Promo Post")).toBeInTheDocument();
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
    expect(screen.queryByText(/^Instagram$/)).toBeNull();
  });
});

describe("PublishingJobRow — human-readable requester", () => {
  it("renders the resolved profile name, never a raw UUID", () => {
    render(
      <PublishingJobRow
        organisationId={ORG_ID}
        job={job({ requestedBy: "0eea9074-18f3-4934-9e20-b2bfde1fef05", requestedByProfile: { id: "0eea9074-18f3-4934-9e20-b2bfde1fef05", fullName: "Bode Villiz", email: "bode@villiz.com" } })}
        draftTitle="A draft"
        campaign={null}
        organisationName="Villiz Pixels"
        attempts={[attempt()]}
        canWrite={true}
      />,
    );

    expect(screen.getByText("Bode Villiz")).toBeInTheDocument();
    expect(screen.queryByText("0eea9074-18f3-4934-9e20-b2bfde1fef05")).toBeNull();
  });

  it("falls back to 'Unknown user' when the profile has been deleted", () => {
    render(
      <PublishingJobRow
        organisationId={ORG_ID}
        job={job({ requestedByProfile: null })}
        draftTitle="A draft"
        campaign={null}
        organisationName="Villiz Pixels"
        attempts={[attempt()]}
        canWrite={true}
      />,
    );

    expect(screen.getByText("Unknown user")).toBeInTheDocument();
  });
});

describe("PublishingJobRow — actions are gated by status", () => {
  it("a published job offers View Job, Open Draft, and Open Mock Post — never Retry or Cancel", () => {
    render(
      <PublishingJobRow
        organisationId={ORG_ID}
        job={job({ status: "published" })}
        draftTitle="A draft"
        campaign={null}
        organisationName="Villiz Pixels"
        attempts={[attempt()]}
        canWrite={true}
      />,
    );

    expect(screen.getByText("View Job")).toBeInTheDocument();
    expect(screen.getByText("Open Draft")).toBeInTheDocument();
    expect(screen.getByText("Open Mock Post")).toBeInTheDocument();
    expect(screen.queryByText("Retry Publish")).toBeNull();
    expect(screen.queryByText("Cancel Job")).toBeNull();
  });

  it("a failed job (with retries remaining) shows the error and offers Retry Publish, never Cancel", () => {
    render(
      <PublishingJobRow
        organisationId={ORG_ID}
        job={job({ status: "failed", retryCount: 1, completedAt: null })}
        draftTitle="A draft"
        campaign={null}
        organisationName="Villiz Pixels"
        attempts={[
          attempt({ attemptNumber: 1, status: "failed", completedAt: null, failedAt: "2026-08-01T10:00:03.000Z", errorCode: "provider_timeout", errorMessage: "Simulated provider failure" }),
        ]}
        canWrite={true}
      />,
    );

    expect(screen.getByText(/Latest error/)).toBeInTheDocument();
    expect(screen.getByText(/Simulated provider failure/)).toBeInTheDocument();
    expect(screen.getByText("Retry Publish")).toBeInTheDocument();
    expect(screen.queryByText("Cancel Job")).toBeNull();
    expect(screen.getByText(/Retry 1\/3/)).toBeInTheDocument();
  });

  it("a failed job already at its retry limit does not offer Retry Publish", () => {
    render(
      <PublishingJobRow
        organisationId={ORG_ID}
        job={job({ status: "failed", retryCount: 3, maxRetries: 3, completedAt: null })}
        draftTitle="A draft"
        campaign={null}
        organisationName="Villiz Pixels"
        attempts={[attempt({ status: "failed", completedAt: null, failedAt: "2026-08-01T10:00:03.000Z", errorMessage: "Simulated provider failure" })]}
        canWrite={true}
      />,
    );

    expect(screen.queryByText("Retry Publish")).toBeNull();
  });

  it("a still-queued job offers Cancel Job, never Retry Publish or Open Mock Post", () => {
    render(
      <PublishingJobRow
        organisationId={ORG_ID}
        job={job({ status: "queued", completedAt: null, scheduledFor: new Date(Date.now() - 60_000).toISOString() })}
        draftTitle="A draft"
        campaign={null}
        organisationName="Villiz Pixels"
        attempts={[]}
        canWrite={true}
      />,
    );

    expect(screen.getByText("Cancel Job")).toBeInTheDocument();
    expect(screen.queryByText("Retry Publish")).toBeNull();
    expect(screen.queryByText("Open Mock Post")).toBeNull();
    expect(screen.getByText(/Waiting for the worker/)).toBeInTheDocument();
  });

  it("a retried job preserves attempt history — attempt count reflects every row, not just the latest", () => {
    render(
      <PublishingJobRow
        organisationId={ORG_ID}
        job={job({ status: "published", retryCount: 1 })}
        draftTitle="A draft"
        campaign={null}
        organisationName="Villiz Pixels"
        attempts={[
          attempt({ id: "attempt-1", attemptNumber: 1, status: "failed", completedAt: null, failedAt: "2026-08-01T10:00:02.000Z" }),
          attempt({ id: "attempt-2", attemptNumber: 2, status: "completed", retryOfAttemptId: "attempt-1" }),
        ]}
        canWrite={true}
      />,
    );

    expect(screen.getByText("Attempts: 2")).toBeInTheDocument();
  });

  it("no write actions render for a viewer without write access", () => {
    render(
      <PublishingJobRow
        organisationId={ORG_ID}
        job={job({ status: "failed", completedAt: null })}
        draftTitle="A draft"
        campaign={null}
        organisationName="Villiz Pixels"
        attempts={[attempt({ status: "failed", completedAt: null, errorMessage: "Simulated provider failure" })]}
        canWrite={false}
      />,
    );

    expect(screen.queryByText("Retry Publish")).toBeNull();
    expect(screen.queryByText("View Job")).toBeNull();
  });
});

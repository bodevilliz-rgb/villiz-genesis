// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CampaignPublicationLiveCard } from "@/components/campaigns/campaign-publication-live-card";
import { CampaignAwoActions } from "@/components/campaigns/campaign-awo-actions";
const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() }, status: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/server/actions/campaign-awo", () => ({ getCampaignAwoJobStatusAction: mocks.status, optimiseCampaignWithAwoAction: vi.fn(), reoptimiseCampaignDistributionWithAwoAction: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const props = { weekNumber: 1, scheduledDate: "2026-01-01", scheduledTime: "12:00", timezone: "UTC", slots: [{ platformLabel: "X", status: "published", draftStatus: "published" }], optimisedCount: 1, approvedCount: 1, onOptimise: null };
it("terminal and blocked cards never refresh", async () => {
  vi.useFakeTimers();
  render(<><CampaignPublicationLiveCard {...props} /><CampaignPublicationLiveCard {...props} approvedCount={0} slots={[{ platformLabel: "X", status: "draft", draftStatus: "draft" }]} /></>);
  await act(() => vi.advanceTimersByTimeAsync(60_000)); expect(mocks.router.refresh).not.toHaveBeenCalled();
});
it("multiple active cards share refresh cadence and exhaust a finite budget across rerenders", async () => {
  vi.useFakeTimers();
  const active = { ...props, slots: [{ platformLabel: "X", status: "processing", draftStatus: "publishing" }] };
  const tree = <><CampaignPublicationLiveCard {...active} /><CampaignPublicationLiveCard {...active} /></>;
  const view = render(tree);
  await act(() => vi.advanceTimersByTimeAsync(15_000)); expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  view.rerender(tree);
  for (let i = 0; i < 50; i++) await act(() => vi.advanceTimersByTimeAsync(15_000));
  const count = mocks.router.refresh.mock.calls.length;
  expect(count).toBeLessThanOrEqual(40);
  await act(() => vi.advanceTimersByTimeAsync(60_000)); expect(mocks.router.refresh).toHaveBeenCalledTimes(count);
});
it("Awo stops on terminal status and never overlaps a slow status request", async () => {
  vi.useFakeTimers(); let resolve!: (v: unknown) => void;
  mocks.status.mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue({ id: "job", status: "completed" });
  render(<CampaignAwoActions organisationId="org" campaignId="campaign" totalSlots={1} optimisedCount={0} canWrite />);
  await act(() => vi.advanceTimersByTimeAsync(30_000)); expect(mocks.status).toHaveBeenCalledOnce();
  await act(async () => resolve({ id: "job", status: "completed" }));
  await act(() => vi.advanceTimersByTimeAsync(60_000)); expect(mocks.status).toHaveBeenCalledOnce();
});
it("Awo exhausts its request budget even if progress keeps changing", async () => {
  vi.useFakeTimers(); let n = 0;
  mocks.status.mockImplementation(async () => ({ id: "job", status: "processing", completedPosts: n++, totalPosts: 200, failedPosts: 0 }));
  render(<CampaignAwoActions organisationId="org" campaignId="budget" totalSlots={200} optimisedCount={0} canWrite />);
  await act(() => vi.advanceTimersByTimeAsync(600_000));
  expect(mocks.status).toHaveBeenCalledTimes(100);
  expect(mocks.router.refresh).not.toHaveBeenCalled();
});
it("does not refresh an active card while React is still committing its previous refresh", async () => {
  vi.useFakeTimers();
  // A suspended route transition keeps the refresh pending beyond several intervals.
  const React = await import("react");
  let trigger!: () => void;
  const unresolved = new Promise<void>(() => {});
  function Route() {
    const [suspended, setSuspended] = React.useState(false);
    trigger = () => setSuspended(true);
    if (suspended) throw unresolved;
    return <CampaignPublicationLiveCard {...props} slots={[{ platformLabel: "X", status: "processing", draftStatus: "publishing" }]} />;
  }
  mocks.router.refresh.mockImplementation(() => trigger());
  render(<React.Suspense fallback="loading"><Route /></React.Suspense>);
  await act(() => vi.advanceTimersByTimeAsync(15_000));
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(mocks.router.refresh).toHaveBeenCalledOnce();
  mocks.router.refresh.mockReset();
});
it("Awo effect restarts do not overlap an outstanding request", async () => {
  vi.useFakeTimers(); const { StrictMode } = await import("react");
  mocks.status.mockImplementation(() => new Promise(() => {}));
  render(<StrictMode><CampaignAwoActions organisationId="org" campaignId="strict" totalSlots={1} optimisedCount={0} canWrite /></StrictMode>);
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(mocks.status).toHaveBeenCalledOnce();
});

import { Skeleton } from "@/components/ui/skeleton";

export default function CampaignsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32 shrink-0" />
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-[76px] rounded-lg" />
        ))}
      </div>

      <Skeleton className="h-10 w-full max-w-2xl rounded-md" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

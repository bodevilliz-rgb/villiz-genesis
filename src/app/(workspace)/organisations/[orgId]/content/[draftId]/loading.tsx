import { Skeleton } from "@/components/ui/skeleton";

export default function DraftDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-6 w-72" />
        </div>
        <Skeleton className="h-9 w-24 shrink-0" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5 rounded-lg border border-border p-6">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-64 w-full" />
          <div className="grid gap-5 sm:grid-cols-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>

        <div className="flex flex-col gap-4">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

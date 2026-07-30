import { Skeleton } from "@/components/ui/skeleton";

export default function MembrainLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32 shrink-0" />
      </div>

      <Skeleton className="h-44 rounded-lg" />
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-10 w-full max-w-2xl rounded-md" />

      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

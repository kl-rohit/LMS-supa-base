// Skeleton placeholders shown while a page's real data loads. They mirror the
// rough shape of the finished screen so the layout doesn't jump when data lands,
// which reads faster and more polished than a centred spinner. The shimmer is
// stilled automatically under prefers-reduced-motion (see index.css).

// Primitive block. Pass Tailwind sizing/shape classes via className.
export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />;
}

// A page title block (title + subtitle line), matching PageTitle's rough size.
export function TitleSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-3.5 w-64 max-w-full" />
    </div>
  );
}

// A row of metric tiles (defaults to 4), matching the MetricCard grid.
export function StatCardsSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl bg-white border border-gray-200 p-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-16 mt-3" />
        </div>
      ))}
    </div>
  );
}

// A bordered panel with a title line and a few content lines.
export function PanelSkeleton({ lines = 4, className = '' }) {
  return (
    <div className={`rounded-xl bg-white border border-gray-200 p-4 sm:p-5 ${className}`}>
      <Skeleton className="h-3 w-28 mb-4" />
      <div className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}

// A list of card-like rows (avatar + two text lines), for roster/table pages.
export function RowsSkeleton({ rows = 6 }) {
  return (
    <div className="rounded-xl bg-white border border-gray-200 divide-y divide-gray-100 overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="w-9 h-9 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40 max-w-[60%]" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

// Composed page skeletons.
export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <TitleSkeleton />
      <StatCardsSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <PanelSkeleton lines={4} />
        <PanelSkeleton lines={4} />
      </div>
    </div>
  );
}

export function ListPageSkeleton({ rows = 8 }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <TitleSkeleton />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <RowsSkeleton rows={rows} />
    </div>
  );
}

export function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <TitleSkeleton />
      <StatCardsSkeleton />
      <PanelSkeleton lines={6} />
    </div>
  );
}

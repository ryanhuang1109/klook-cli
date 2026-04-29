// Shown instantly when navigating between dashboard routes while the server
// re-renders the next page. Without this Next blocks on the dynamic render
// and the screen looks frozen.
export default function DashboardLoading() {
  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6 animate-pulse">
      <div className="h-7 w-40 rounded bg-zinc-200" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[88px] rounded-xl border border-zinc-200/80 bg-white" />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="h-8 w-16 rounded-full bg-zinc-200" />
        <div className="h-8 w-20 rounded-full bg-zinc-200" />
        <div className="h-8 w-20 rounded-full bg-zinc-200" />
        <div className="h-8 w-20 rounded-full bg-zinc-200" />
      </div>
      <div className="rounded-xl border border-zinc-200/80 bg-white overflow-hidden">
        <div className="h-10 border-b border-zinc-200/70 bg-zinc-50/50" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 border-b border-zinc-100 last:border-b-0" />
        ))}
      </div>
    </div>
  );
}

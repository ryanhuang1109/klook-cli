export const metadata = { title: 'Archive — CSI' };

const ENTRIES: Array<{ title: string; tag: string; body: React.ReactNode }> = [
  {
    title: 'Tours dashboard',
    tag: 'archived',
    body: (
      <p className="text-sm text-zinc-600">
        Removed from nav. Daily pricing now flows through Activities / Coverage / Runs.
        Refresh data via the CLI: <Code>tours run --destination tokyo --keyword &quot;mt fuji&quot;</Code>.
      </p>
    ),
  },
  {
    title: 'POI Compare',
    tag: 'CLI only',
    body: (
      <p className="text-sm text-zinc-600">
        Cross-platform price clustering lives in the CLI:{' '}
        <Code>compare-poi &lt;name&gt; --date YYYY-MM-DD --save</Code>. POI config and
        history are local only — not yet mirrored to Supabase.
      </p>
    ),
  },
  {
    title: 'Landing & About',
    tag: 'removed',
    body: (
      <p className="text-sm text-zinc-600">
        The marketing-style index/about pages were dropped. The dashboard root redirects
        directly to Activities.
      </p>
    ),
  },
];

export default function ArchivePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Archive</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Features no longer surfaced in the dashboard. Underlying CLI commands still work.
        </p>
      </div>

      <div className="space-y-3">
        {ENTRIES.map((e) => (
          <div
            key={e.title}
            className="rounded-xl border border-zinc-200/80 bg-white p-5"
          >
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="font-semibold">{e.title}</h2>
              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-100 text-zinc-600">
                {e.tag}
              </span>
            </div>
            {e.body}
          </div>
        ))}
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-xs bg-zinc-100 text-zinc-800 px-1.5 py-0.5 rounded font-mono">
      {children}
    </code>
  );
}

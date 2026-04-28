import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },

  async redirects() {
    return [
      // Legacy static-dashboard URLs map onto the new App Router routes.
      // The .html ones can be dropped once external bookmarks are gone.
      { source: '/dashboard.html', destination: '/archive', permanent: false },
      { source: '/index.html', destination: '/activities', permanent: false },
      { source: '/about.html', destination: '/archive', permanent: false },
      { source: '/activities.html', destination: '/activities', permanent: false },
      { source: '/coverage.html', destination: '/coverage', permanent: false },
      { source: '/runs.html', destination: '/runs', permanent: false },
      { source: '/executions.html', destination: '/executions', permanent: false },
      { source: '/cron.html', destination: '/cron', permanent: false },
      { source: '/archive.html', destination: '/archive', permanent: false },
      { source: '/whitelist.html', destination: '/whitelist', permanent: false },
      // Shortcuts to the latest static report/CSV (files copied into
      // public/reports and public/exports during vercel-build).
      { source: '/report', destination: '/reports/latest.html', permanent: false },
      { source: '/csv', destination: '/exports/latest.csv', permanent: false },
    ];
  },
};

export default nextConfig;

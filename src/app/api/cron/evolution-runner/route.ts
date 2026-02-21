// Legacy cron path — re-exports from unified endpoint.
// Safe to delete once vercel.json is confirmed pointing to /api/evolution/run.
export { GET, POST, maxDuration } from '@/app/api/evolution/run/route';

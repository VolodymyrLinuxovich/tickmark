// Checks the Ramp connection Tickmark will use and reports what it can read.
//   npm run ramp:check            (reads .env.local if present)
// Uses the same getConnection() as the app, so it shows exactly which credentials the server would pick,
// then reads the last 365 days and prints record counts and how approvals were obtained.
import { existsSync } from "node:fs";
import { getConnection } from "../src/lib/ramp/source";

if (existsSync(".env.local")) process.loadEnvFile?.(".env.local");

const conn = getConnection();
if (!conn.connected) {
  console.log(`Not connected: ${conn.reason}`);
  console.log(`
Connect one of these ways:
  1. Developer app (works on Vercel): in demo.ramp.com or app.ramp.com, create a developer app with the
     client credentials grant, then set RAMP_CLIENT_ID and RAMP_CLIENT_SECRET (and RAMP_ENV=production for live).
  2. Your own login (local only): install the Ramp CLI and run \`ramp auth login\`; Tickmark reads its saved token.
  3. Any access token: set RAMP_ACCESS_TOKEN.`);
  process.exit(1);
}

const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
console.log(`Connected via ${conn.source.info.label} at ${conn.source.info.base_url}`);
console.log(`Reading ${from} to ${to}...`);
const t0 = Date.now();
conn.source
  .snapshot({ from, to })
  .then((s) => {
    const notes = (s as { notes?: { approvals: string; warnings: string[] } }).notes;
    console.log(`Business: ${s.business_name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    console.log(`  users ${s.users.length}, transactions ${s.transactions.length}, receipts ${s.receipts.length}, bills ${s.bills.length}, vendors ${s.vendors.length}, approvals ${s.approvals.length}`);
    console.log(`  approvals read via: ${notes?.approvals ?? "n/a"}`);
    for (const w of notes?.warnings ?? []) console.log(`  note: ${w}`);
  })
  .catch((e) => {
    console.error(`Failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });

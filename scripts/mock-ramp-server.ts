// Runs the spec-shaped mock Ramp API for local end-to-end checks:
//   npx tsx scripts/mock-ramp-server.ts
// then start the app with RAMP_API_BASE_URL=<printed url> RAMP_CLIENT_ID=ramp_id_test RAMP_CLIENT_SECRET=ramp_sec_test
import { startMockRamp } from "../tests/mock-ramp";

startMockRamp().then((m) => {
  m.failNextWith429 = false;
  console.log(m.url);
  process.on("SIGTERM", () => m.close().then(() => process.exit(0)));
});

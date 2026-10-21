import type { NextConfig } from "next";

const samples = ["./public/samples/**"];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Route handlers read the sample request lists from disk at runtime.
  outputFileTracingIncludes: {
    "/api/parse": samples,
    "/api/eval": samples,
    "/eval": samples,
  },
};

export default nextConfig;

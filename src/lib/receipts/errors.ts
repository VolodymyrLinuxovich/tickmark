import { RampHttpError } from "../ramp/api-client";

/** A Ramp failure in words the user can act on. A 403 on a write almost always means a missing scope. */
export function rampError(err: unknown, scope: string): { error: string; status: number } {
  if (err instanceof RampHttpError && (err.status === 401 || err.status === 403)) {
    return { error: `Ramp refused this. The Tickmark app in Ramp needs the ${scope} permission${scope.includes(" and ") ? "s" : ""}: Company, Developer, Tickmark, Configure allowed scopes.`, status: 403 };
  }
  return { error: String(err instanceof Error ? err.message : err).slice(0, 300), status: 502 };
}

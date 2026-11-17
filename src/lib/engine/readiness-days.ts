// The readiness window from a link. Kept apart from readiness.ts so the client view can use it
// without pulling the audit engine into the browser bundle.

/**
 * The window in days from a `days` query value: 30 to 180, and 90 when it is missing or not a number.
 * Shared by the API route and the /readiness page, so a shared link opens on the same window it fetches.
 */
export function readinessDays(value: string | null | undefined): number {
  return Math.min(180, Math.max(30, Number(value) || 90));
}

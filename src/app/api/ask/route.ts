import { z } from "zod";
import { getSource } from "@/lib/ramp/source";
import { buildIndex } from "@/lib/engine/run";
import { planQuestion } from "@/lib/ask/plan";
import { FISCAL_YEAR } from "@/lib/fixtures/generate";
import { runPlan, vocabulary } from "@/lib/ask/run";

export const maxDuration = 120;

const Body = z.object({
  question: z.string().min(3).max(500),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // The model is only called when the user agrees: the free keyword reader goes first.
  allow_model: z.boolean().default(false),
});

/** Ask your books: question in, matching Ramp records out. Read only. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Ask a question of at least a few words." }, { status: 400 });
  const { question, allow_model } = parsed.data;
  const source = getSource();
  // No period on the requests: sample data uses its own fiscal year, live Ramp data the last 365 days.
  // The period is returned with the answer, and the binder reruns the question on it.
  const fixture = source.info.kind === "fixture";
  const to = parsed.data.period_to ?? (fixture ? FISCAL_YEAR.end : new Date().toISOString().slice(0, 10));
  const from = parsed.data.period_from ?? (fixture ? FISCAL_YEAR.start : new Date(Date.parse(to) - 365 * 864e5).toISOString().slice(0, 10));
  try {
    const snap = await source.snapshot({ from, to });
    const planned = await planQuestion(question, vocabulary(snap), { allowModel: allow_model });
    if (!planned) {
      return Response.json({ needs_model: !allow_model, error: allow_model ? "Could not turn that into a query. Try naming an amount, merchant, person or date." : null });
    }
    const result = runPlan(planned.plan, snap, buildIndex(snap), { period: { from, to } });
    return Response.json({ by: planned.by, plan: planned.plan, result });
  } catch (err) {
    return Response.json({ error: `Could not read from Ramp: ${String(err).slice(0, 200)}` }, { status: 502 });
  }
}

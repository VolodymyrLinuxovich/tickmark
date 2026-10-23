// What the controller adds on top of the request list when building a binder: exception statuses and
// "Ask your books" questions. Shared by the binder route and the auditor portal, so both binders match.

import { z } from "zod";
import { PlanSchema } from "../ask/plan";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const StatusSchema = z.object({ status: z.enum(["open", "resolved", "waived"]), note: z.string().max(500).optional() });

// Exception statuses set in the app, keyed by finding id. Shown in the workpapers and the index.
export const StatusesSchema = z.record(z.string(), StatusSchema);

// An Ask question added to the binder. The plan is rerun on Ramp data; `period` is the one Ask
// answered on, so the rerun returns the rows the user saw.
export const ExtraSchema = z.object({ question: z.string().max(500), plan: PlanSchema, period: z.object({ from: Day, to: Day }).optional() });
export const ExtrasSchema = z.array(ExtraSchema).max(20);

export type BinderExtraInput = z.infer<typeof ExtraSchema>;

# Tickmark

Every year a company's auditor sends a "PBC" list: 30 to 100 requests like *"support for these 25 card transactions"* or *"approval evidence for every bill over $10,000"*. A controller then spends days pulling receipts, screenshotting approvals and building folders by hand.

Ramp already holds the receipts, approvals, bills and payments. Tickmark reads the auditor's list, pulls the evidence from Ramp, runs the control tests auditors run, and returns a binder where every line traces to a Ramp record. Exceptions come with a drafted Ramp comment to the right person, sent only after you approve it.

Built for the BBS x Ramp Hackathon (Build track): *pick an outdated financial workflow and rebuild it with the newest AI tools.*

## What it does

1. **Read the request list.** Excel, CSV or a pasted email. Claude (`claude-opus-5-5`, structured output) turns each request into a typed query: request type, period, dollar threshold and the auditor's selected items. A keyword parser runs alongside as a cross-check and as the fallback when no API key is set or the call fails. You review and edit the plan before anything runs.
2. **Pull and test.** For each request Tickmark reads Ramp data and runs fixed checks written as code. The model never decides pass or fail.
3. **Close the gaps.** Each exception lists its Ramp records and has a drafted comment for the cardholder or bill owner. Approve it and it posts to the transaction or bill thread in Ramp.
4. **Hand over the binder.** A ZIP with `00 Index.xlsx` (requests, exceptions, evidence rows with Ramp ids), a PDF workpaper per request (procedure, evidence table with tickmarks, exceptions) and the receipts and invoices.

| Request type | What Tickmark does |
|---|---|
| Transaction support | Matches each auditor selection to a Ramp transaction (amount, date within 5 days of transaction or posting date, description), then agrees it to the receipt OCR total, traces the approval and checks the memo. With no selections, draws a monetary unit sample. |
| Bill support | Every bill over the threshold: invoice attached, approver is not the bill owner, approved before payment, payment traced. |
| Missing receipts | Card transactions at or above the threshold with no receipt. |
| Control testing | Split purchases (same cardholder and merchant within 48 hours, each under the $5,000 approval limit, together over it), self-approval, approval after payment, restricted merchant categories. |
| Duplicate payments | Same vendor and invoice number, or same vendor and amount within 7 days. |
| Vendor listing | Vendor master export; flags new vendors paid within 14 days of setup. |
| User access | Users with owner, admin, bookkeeper, IT admin or auditor roles. |
| Manual | Anything outside Ramp (bank recs, fixed assets) is marked for the team. |

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # engine, parser, sampling and binder tests
```

With no configuration it runs on **Acme Robotics**, a generated demo company whose records use the exact field names of the Ramp Developer API: 720 card transactions, 638 receipts, 75 bills, 16 vendors and 35 users for FY2025. The data is clean except for eight planted problems. `/eval` runs the sample request list end to end and scores what Tickmark finds (currently 8 of 8 found, 0 false alarms).

Sample inputs live in `public/samples/` (Excel PBC list with a Selections tab, CSV, and the same list as an email). Regenerate them with `npm run samples`.

### Environment

Copy `.env.example` to `.env.local`.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the Claude request parser. Without it the keyword parser is used. |
| `TICKMARK_SOURCE` | `fixture` (default), `sandbox` (`demo-api.ramp.com`) or `production` (`api.ramp.com`). |
| `RAMP_CLIENT_ID`, `RAMP_CLIENT_SECRET` | A Ramp developer app with the client credentials grant. Read scopes: `transactions:read receipts:read bills:read users:read departments:read vendors:read approvals:read business:read`. Posting comments also needs `transactions:write` and `bills:write`. |
| `TICKMARK_PARSER` | Set to `rules` to force the keyword parser. |

The live Ramp client (`src/lib/ramp/api-client.ts`) follows the Developer API docs: client credentials token at `/developer/v1/token`, `page.next` pagination, `/approvals` batched by entity id, and comments via `/developer/v1/comments/{bills|transactions}/{id}`. It has not yet been run against a Ramp sandbox, because sandbox access is not self-serve.

## How it is built

```
request list (xlsx / csv / email)
   -> parse/input.ts      rows, selections, text
   -> parse/claude.ts     Claude structured output (zod schema), rules parser as cross-check and fallback
   -> plan review (UI)    edit types before running
   -> ramp/source.ts      fixture or Ramp Developer API snapshot for the period
   -> engine/run.ts       per-request handlers and checks, all deterministic
   -> binder/build.ts     index workbook, PDF workpapers, evidence files
   -> /api/comment        approved drafts post to Ramp comment threads
```

Next.js 16 (App Router), TypeScript, `@anthropic-ai/sdk`, zod, exceljs, pdf-lib, jszip, vitest.

## Limits

- The demo company is generated, so the 8 of 8 score shows that the checks work as designed. It is not a measure of accuracy on real books.
- Policy values (approval limit, receipt threshold, restricted merchant codes) are constants in `engine/run.ts`. A real deployment should read them from the company's Ramp spend policy.
- Receipt checks use the OCR total Ramp already stores. Tickmark does not re-read receipt images.
- In demo mode, receipts and invoices in the binder are rendered from the record fields and labeled as such.

## Demo script (3 minutes)

1. **The problem (20 s).** "It's January. Hartwell & Co. sent Acme's controller nine requests and twelve sampled transactions. Today that means two weeks of screenshots and email."
2. **Drop the list (20 s).** Load the Excel PBC list. Show the plan: nine requests, seven answerable from Ramp, the period and thresholds read correctly, two marked manual.
3. **Pull evidence (20 s).** Run it. Every request resolves in under a second.
4. **One exception (60 s).** Open the split purchase: two Digi-Key charges 17 minutes apart, $4,860.00 and $4,725.50, each under the $5,000 limit. Click through to the raw Ramp record. Open the drafted comment to the engineer and approve it.
5. **The binder (30 s).** Download the ZIP. Open the PBC-02 workpaper: procedure, evidence table with tickmarks, the two exceptions with Ramp ids.
6. **Trust (30 s).** Open `/eval`: eight planted problems, eight found, zero false alarms, and the limits stated plainly.

**Pitch.** Ramp already collects every receipt and approval. Audits still run on email and screenshots. Tickmark turns the auditor's request list into a cited evidence binder in minutes, and flags control gaps before the auditor does.

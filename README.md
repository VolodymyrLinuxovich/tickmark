<div align="center">

# Tickmark

**Your auditor's request list, answered from Ramp.** Tickmark reads the year-end **PBC request list**, pulls the
receipts, approvals, bills and payments behind every request **straight from Ramp**, runs the **control tests auditors
run**, and hands back an **evidence binder** where every line traces to a Ramp record. Problems come with a drafted
Ramp comment to the right person, sent only after you approve it.

<br/>

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Claude](https://img.shields.io/badge/Claude_API-D97757?style=for-the-badge&logo=anthropic&logoColor=white)
![Ramp API](https://img.shields.io/badge/Ramp_Developer_API-1B1B18?style=for-the-badge)
![MCP](https://img.shields.io/badge/MCP_server-17714A?style=for-the-badge)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)

<br/>

</div>

---

**Hackathon:** BBS x Ramp Hackathon (Berkeley Business Society)<br/>
**Challenge:** Pick an outdated financial workflow and rebuild it for 2026 with the newest AI tools<br/>
**Track:** Build it<br/>
**Team:** Volodymyr Borysenko, Mert Ozkardes<br/>
**Live demo:** [tickmark-eta.vercel.app](https://tickmark-eta.vercel.app)

| Page | What you'll find |
|------|------------------|
| [Overview](https://tickmark-eta.vercel.app) | The problem, the solution, what it checks (also in `/es`, `/de`, `/fr`, `/uk`) |
| [Sample audit](https://tickmark-eta.vercel.app/app?sample=xlsx) | Nine auditor requests, read, tested and turned into a binder |
| [App](https://tickmark-eta.vercel.app/app) | Upload your own request list (Excel, CSV, PDF or the auditor's email) |
| [Accuracy](https://tickmark-eta.vercel.app/eval) | Scores on a company with eight planted control problems |
| `/portal/{id}` | Read-only auditor portal, shared from a run |
| `/api/mcp` | MCP server, so an agent can run an audit request |

---

## The Problem

Every audit starts the same way. The auditor sends a spreadsheet of requests: **support for these 25 card charges**,
**approval evidence for every bill over $10,000**, **a list of who has admin access**. A controller then spends days
finding receipts, screenshotting approvals, matching payments and filing it all into folders. Ramp's own blog puts it
plainly: preparing for an audit "means gathering receipts, matching transactions, and exporting clean records," and it
["can take days."](https://ramp.com/blog/prepare-data-for-audits-and-compliance-reviews)

The data is already in Ramp. What's missing is the workflow: reading the auditor's list, answering each request with
evidence, and catching the control gaps (a split purchase, a self-approved bill, a bill paid before approval) **before
the auditor does.** Ramp offers exports; Tickmark turns the request list itself into the deliverable.

---

## Built With

| Area | Stack |
|------|-------|
| **App** | Next.js 16 (App Router, Cache Components) · React 19 · TypeScript |
| **Reading requests** | Claude (`claude-opus-5-5`) or OpenAI (`gpt-5.5`), structured output against a zod schema · keyword parser as cross-check and fallback |
| **Ramp data** | Ramp Developer API: transactions, receipts (OCR), bills, approvals, vendors, users, audit logs, comments |
| **Auth** | OAuth client credentials (developer app) · user access token · Ramp CLI login |
| **Audit engine** | Deterministic checks · monetary unit sampling · fuzzy selection matching |
| **Binder** | exceljs (index workbook) · pdf-lib (workpapers) · jszip |
| **Auditor portal** | Vercel Blob (private JSON, 14 day links) |
| **Agents** | MCP server (`mcp-handler`, Streamable HTTP), read-only tools |
| **Tests** | Vitest · a spec-shaped mock Ramp API · Playwright for end-to-end runs |
| **Hosting** | Vercel |

---

## Architecture at a Glance

```mermaid
flowchart LR
    subgraph IN["Inputs"]
        PBC[Auditor request list<br/>xlsx, csv or email]
    end

    subgraph RAMP["Ramp Developer API"]
        TX[Transactions<br/>+ receipts with OCR]
        BL[Bills<br/>+ invoices, payments]
        AP[Approvals<br/>or bill history + audit logs]
        VU[Vendors, users,<br/>departments]
    end

    subgraph ENG["Tickmark"]
        PA[Read requests<br/>Claude + rules cross-check]
        PL[Plan review<br/>you edit before anything runs]
        CK[Checks<br/>plain code, no model]
        BD[Binder builder]
    end

    subgraph OUT["Outputs"]
        UI[Exceptions with<br/>Ramp record links]
        ZIP[Evidence binder<br/>index, workpapers, documents]
        CM[Approved comments<br/>on Ramp threads]
        MCP[MCP tools<br/>for agents]
    end

    PBC --> PA --> PL --> CK
    TX --> CK
    BL --> CK
    AP --> CK
    VU --> CK
    CK --> UI
    CK --> BD --> ZIP
    UI --> CM
    CK --> MCP
```

### One audit run

```mermaid
sequenceDiagram
    participant C as Controller
    participant T as Tickmark
    participant L as Claude
    participant R as Ramp API

    C->>T: upload the PBC list
    T->>L: request list text (structured output)
    L-->>T: typed requests: type, period, threshold, selections
    T-->>C: plan to review and edit
    C->>T: pull evidence
    T->>R: token, then paged reads (transactions, receipts, bills, vendors, users)
    T->>R: approvals for every transaction and bill (batches of 50)
    T->>T: match selections, agree receipts, trace approvals, run control tests
    T-->>C: results, exceptions, drafted follow-ups
    C->>T: approve a follow-up
    T->>R: POST /comments/{transactions|bills}/{id}
    C->>T: download binder
    T->>R: pre-signed receipt and invoice files
    T-->>C: ZIP: index, workpaper per request, documents
```

---

## How It Works

1. **Read the list.** Excel (including a separate Selections sheet), CSV, a text PDF or a pasted email. Claude (or OpenAI) turns each request
   into one of seven types with its period, dollar threshold and the items the auditor selected. A keyword parser runs
   on the same input as a cross-check, and takes over if the model call fails. Requests Ramp can't answer (bank recs,
   fixed assets) are marked for the team.
2. **Review the plan.** Nothing runs until the controller checks it and starts the run. Any type can be changed.
3. **Gather.** One snapshot of the period from Ramp, paged and cached for five minutes. Receipts are read 90 days past
   the period end, since they often arrive after the charge.
4. **Test.** Every pass or fail is code over Ramp records:

| Request type | What Tickmark does |
|---|---|
| Transaction support | Matches each auditor selection to a Ramp transaction (exact amount, date within 5 days of transaction or posting date, description tokens), then agrees it to the receipt OCR total (within $1 or 1%), traces the approval and checks the memo. Without selections it draws a monetary unit sample. |
| Bill support | Every bill over the threshold, or exactly the bills the auditor selected (matched by amount, date within 5 days and vendor): invoice attached, approver is not the bill owner, approved before payment, payment traced. |
| Missing receipts | Card charges at or above the receipt threshold with nothing attached, unless Ramp marks the charge as meeting the company's own receipt policy. |
| Control testing | Split purchases (same cardholder and merchant within 48 hours, each under the approval limit, together over it), self-approval, approval after payment, restricted merchant categories. |
| Duplicate payments | Same vendor and invoice number, or same vendor and amount within 7 days. Archived bills are skipped. |
| Vendor listing | Vendor master; flags new vendors paid within 14 days of setup. |
| User access | Owners, admins, bookkeepers, IT admins and auditors, with status. |

5. **Hand over.** The results open with a plain summary, with exceptions grouped by person and type and sorted by
   severity, then by dollars at stake. Each exception
   links to its Ramp records and carries a drafted comment for the cardholder or bill owner, or for the next approver
   when an approval is still pending. Approve it and it posts to that Ramp thread, starting one if none exists. Mark
   each exception open, resolved or waived with a note. The binder holds `00 Index.xlsx` (requests, exceptions with their status, evidence rows with Ramp ids), a PDF workpaper
   per request (reference WP-01 onward, conclusion, evidence with tickmarks, exceptions, prepared and reviewed sign-off,
   page numbers), and every receipt and invoice.

### After the run

| Tool | What it does |
|---|---|
| **Watch Ramp** | After a comment is sent or a receipt attached, the record is rechecked in Ramp every few seconds. Replies show up next to the exception, and a missing receipt, approval or invoice is marked resolved once Ramp shows the fix. |
| **Receipt hunter** | Drop in receipt emails (.eml), PDFs or photos. Each file is matched to a charge with no receipt by amount, merchant and date, with the reasons shown, and attached to the Ramp transaction after you confirm. A demo inbox shows the flow without mail. |
| **Ask your books** | Plain-English questions ("weekend charges over $500", "bills approved by nobody") become filters run as code on the Ramp snapshot. A keyword reader handles common questions; a model reads the question only when asked, and never sees Ramp data. Every answer says who read it and can be added to the binder as its own workpaper. |
| **Auditor portal** | A read-only share link for the auditor, valid 14 days. The auditor sees the requests and results, recomputed from Ramp on each visit, and can ask questions on any request. Only the controller's browser can answer. |

---

## Why We Built It This Way

**The model reads. Code decides.** A language model only turns the auditor's list into a typed plan, checked against a
zod schema. Every pass or fail is plain code over Ramp records. An auditor has to be able to re-perform a test and get
the same answer, and a model verdict can't promise that. It also means no model sees Ramp data in the main flow.

**A person checks the plan first.** A misread request is the most expensive mistake, because the binder then answers the
wrong question with confidence. The plan screen shows the model's reason for each request, and a keyword parser counts
the requests on its own and warns when the counts differ.

**Nothing is written to Ramp without a click.** Comments and receipt uploads are drafted, then sent only after the
controller approves each one. The MCP server is read-only for the same reason: an agent can run an audit request, but a
person sends the follow-up.

**The Developer API, not MCP.** A binder needs every receipt file and every row. Ramp's MCP server returns at
most 100 rows and can't download files. The Developer API gives both, and client credentials work on a server, so the hosted app runs on a real Ramp business.

**Read once, test in memory.** One paged read of the period is cached for five minutes, and all nine requests run on it
in under 100 ms. Repeated runs and follow-up questions don't hit Ramp's rate limits. The trade-off is data up to five
minutes old, so Watch Ramp rechecks single records live after a fix.

**Rank by money at stake.** On the Ramp sandbox, 116 of 122 exceptions were approvals Ramp opened that nobody finished.
Listing them all as high buried the ones that matter. Open approvals are graded against the company's own limits: over
the pre-approval limit is high, over the receipt floor is medium, the rest is low and folded away.

**Score it on known answers.** Real books don't come with an answer key. So `/eval` runs on a generated company that
uses Ramp's exact field names and has eight planted problems, and it counts false alarms as well as finds.

**Hand over what auditors already use.** Workpapers with WP references, tickmarks, a conclusion and sign-off, plus an
index workbook. The auditor doesn't learn a new tool, and every line keeps its Ramp id.

**One Next.js app on Vercel.** The UI, the API routes and the MCP server ship as one deploy. Vercel Blob holds the
auditor portal links. A two-person team can run it without separate services.

---

## Results

### Accuracy on a company with planted problems

`/eval` runs the sample request list end to end on Acme Robotics, a generated company whose records use Ramp's exact
API field names: 720 card transactions, 638 receipts, 75 bills, 16 vendors, 35 users. Everything is clean except eight
planted problems.

| Planted problem | Check | Found |
|---|---|---|
| Two Digi-Key charges 17 minutes apart, $9,585.50 together, each under the $5,000 limit | Split purchase | ✅ |
| $1,240.00 client dinner, no receipt | Missing receipt | ✅ |
| Receipt says $389.00, card charged $839.00 | Receipt mismatch | ✅ |
| Bill owner approved their own $12,750.00 bill | Self-approval | ✅ |
| $22,300.00 bill paid Jun 2, approved Jun 9 | Approval after payment | ✅ |
| Apex invoice INV-20417 paid twice | Duplicate invoice | ✅ |
| Vendor created Nov 3, paid $18,400.00 two days later | Fast-paid new vendor | ✅ |
| $612.40 at a liquor store, no business purpose | Restricted merchant | ✅ |

**8 of 8 found, 0 false alarms.** The checks run in about 10 ms for all nine requests.

### Against the Ramp API

`tests/live-api.test.ts` runs the live client against a mock Ramp API built to the published spec (client credentials
token, `page.next` pagination, repeated `entity_ids`, scope errors, `get-bill-history`, audit log events, comments,
pre-signed files). It checks that:

- A developer app reads every page and produces **exactly the same findings** as the sample run.
- A **Ramp CLI token without `approvals:read`** rebuilds approvals from bill history and audit logs and still finds all
  eight problems.
- The binder contains the **downloaded** receipt and invoice files.
- Approved comments post to the right thread with a write-scoped token. Rate limits (429) are retried.

### On a real Ramp sandbox

The hosted app runs on a Ramp sandbox business, Save Time Inc: 43 users, 1,170 card transactions, 152 receipts, 6
bills, 419 vendors and 143 approvals over the last 12 months.

- The sample list, fitted to this business, answers 7 of 9 requests. The other two (bank reconciliation, fixed assets)
  are outside Ramp data and go to the team.
- 122 exceptions: 12 high, 74 medium, 36 low. The list opens on a $29,407.46 Hyatt charge with no approval and an
  $18,000.00 approval still pending.
- The receipt hunter's demo inbox matched 33 of 43 receipts to charges, with 0 wrong matches.
- Writes are verified end to end: a receipt attached to an Office Depot charge, and an approver nudge posted as a Ramp
  comment.

**Caveats.** The planted company is generated, so a perfect score shows the checks work as designed, not accuracy on
real books. The sandbox is Ramp's demo data, not a company under audit. Neither replaces a run on a real audit.

---

## Connecting Ramp

Tickmark uses real Ramp data whenever credentials are present, and falls back to the sample company only when none are.

| Method | Where it works | Set |
|---|---|---|
| **Developer app** (client credentials) | Local and Vercel | `RAMP_CLIENT_ID`, `RAMP_CLIENT_SECRET` |
| **Access token** | Local and Vercel | `RAMP_ACCESS_TOKEN` |
| **Ramp CLI login** | Local | run `ramp auth login`; Tickmark reads `~/.config/ramp/config.toml` |

`RAMP_ENV=production` switches from the sandbox (`demo-api.ramp.com`) to `api.ramp.com`. Check a connection with
`npm run ramp:check`.

**Scopes read:** `transactions:read receipts:read bills:read users:read departments:read vendors:read approvals:read
business:read audit_logs:read`. **Writes:** only actions you approve: comments (`transactions:write` or `bills:write`,
plus `comments:write` to start a new thread) and receipt uploads (`receipts:write`).

**Getting a sandbox.** The Ramp CLI can start a sandbox application (`ramp --env sandbox applications create`), which
emails a sign-up link for demo.ramp.com. From the sandbox dashboard, create a developer app with the client credentials
grant and copy its id and secret into `.env.local` (and Vercel). When connected, the sample request list is fitted to
your business: the last 12 months, with 12 selections drawn from your own transactions by monetary unit sampling.

---

## Agent API: MCP

`/api/mcp` is a Streamable HTTP MCP server with three read-only tools.

| Tool | Returns |
|------|---------|
| `read_request_list` | Typed requests from a request list (type, period, threshold, selections) |
| `answer_audit_requests` | Each request's result, every exception with its Ramp records, and a drafted follow-up |
| `get_ramp_record` | The transaction, bill, vendor or user behind an exception, with receipts and approvals |

```bash
claude mcp add --transport http tickmark https://tickmark-eta.vercel.app/api/mcp
```

Nothing is posted to Ramp through MCP. Drafts come back to the agent, and sending stays in the app behind a person's
approval.

---

## Run It

```bash
npm install
npm run dev              # http://localhost:3000
npm test                 # engine, parser, sampling, binder, ask, receipts, portal, MCP and live API contract tests
npm run ramp:check       # which Ramp connection will be used and what it can read
```

Settings in `.env.local`:

```bash
# Ramp (any one of these)
RAMP_CLIENT_ID=...
RAMP_CLIENT_SECRET=...
# RAMP_ACCESS_TOKEN=...
# RAMP_ENV=production           # default: sandbox

# Request reader: Claude first, then OpenAI. Without either key, the keyword parser reads requests.
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
# OPENAI_MODEL=gpt-5.5
# TICKMARK_PARSER=openai         # claude | openai | rules pins one parser

# Policy values in dollars (defaults 5000 and 75)
# TICKMARK_CARD_APPROVAL_LIMIT=5000
# TICKMARK_RECEIPT_THRESHOLD=75

# TICKMARK_SOURCE=sample        # force the sample company

# Auditor portal storage. Without it, portals live in memory (local only).
# BLOB_READ_WRITE_TOKEN=...
```

Run the whole app against the mock Ramp API:

```bash
npm run mock:ramp        # prints the mock URL
RAMP_API_BASE_URL=<url> RAMP_CLIENT_ID=ramp_id_test RAMP_CLIENT_SECRET=ramp_sec_test npm run dev
```

Record the demo video (Chrome, visible cursor, chapter timestamps):

```bash
npm run build && npx next start -p 3790
node scripts/record-demo.mjs http://localhost:3790 demo-out
```

---

## Code Map

| Path | What |
|------|------|
| `src/app/page.tsx` | Landing page: intro, problem, solution |
| `src/app/workbench/` | The app, one file per screen: intake, plan, running, results, exceptions, record drawer |
| `src/app/eval/` | Accuracy page |
| `src/app/ask-books.tsx`, `receipt-hunter.tsx`, `loop.tsx` | Ask your books, receipt hunter, Ramp watch |
| `src/app/portal/`, `portal-share.tsx` | Auditor portal page and the controller's share panel |
| `src/app/api/` | `parse`, `run`, `binder`, `comment`, `record`, `eval`, `mcp`, `ask`, `recheck`, `receipts`, `portal` routes |
| `src/lib/parse/` | Input reading (xlsx, csv, pdf, email), model parser (Claude, then OpenAI), keyword parser, request schema |
| `src/lib/engine/run.ts` | Request handlers and every check |
| `src/lib/engine/sampling.ts` | Monetary unit sampling |
| `src/lib/engine/live-sample.ts` | Fits the sample list to a connected Ramp business |
| `src/lib/engine/recheck.ts` | Decides when a watched exception is fixed in Ramp |
| `src/lib/ask/` | Question to query plan (keywords, then a model) and the plan runner |
| `src/lib/receipts/` | Receipt file reading and matching to charges |
| `src/lib/portal/store.ts` | Portal storage (Vercel Blob or memory) |
| `src/lib/i18n.ts` | Landing page translations |
| `src/lib/ramp/api-client.ts` | Ramp API client: auth modes, paging, retries, approvals fallback |
| `src/lib/ramp/source.ts` | Picks Ramp or the sample company; snapshot cache; record lookup |
| `src/lib/binder/build.ts` | Index workbook, PDF workpapers, evidence files |
| `src/lib/fixtures/generate.ts` | The sample company and its eight planted problems |
| `tests/mock-ramp.ts` | Spec-shaped mock Ramp API |
| `scripts/` | Sample files, Ramp check, mock server, demo recorder |

---

## Limits

- Tested on a spec-shaped mock and a Ramp sandbox business, not yet on a company's production Ramp account.
  `npm run ramp:check` is the first thing to run once credentials exist.
- Receipts follow Ramp's receipt policy, but the card approval limit and the receipt floor come from environment
  variables, and restricted merchant codes are fixed in code.
- Receipt checks compare the OCR total Ramp stores with the charge. Receipt images are not re-read.
- Amounts are shown in USD.
- On the sample company, approved comments go to an in-memory outbox, receipt uploads are not stored, and replies
  and fixes in the Ramp watch are simulated.

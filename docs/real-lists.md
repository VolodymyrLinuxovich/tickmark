# Tickmark on real request lists

Until now the parser was scored only on lists we generated ourselves. This page scores it on five request lists that are posted publicly, with answers written by hand. Checked on October 29, 2026.

## The lists

| # | List | Who posted it | Source | Requests | Ramp can answer |
|---|------|---------------|--------|---------:|----------------:|
| 1 | UC Hastings (now UC Law SF) year-end PBC list, FYE June 30, 2015 | The college, as Appendix III of audit RFP 56-0170. The list was written by its external auditor (the confirmation contact in it is Hood & Strong). | [PDF](https://bpb-us-e2.wpmucdn.com/sites.uclawsf.edu/dist/6/18/files/2016/01/3-_RFP_56-0170_APP_III_2015-YEAR-END-PBC-List-20uz1ia.pdf) | 131 | 3 |
| 2 | Buncombe County, NC sample PBC list | The county, as Exhibit B of its January 2023 audit RFP | [PDF](https://media.buncombenc.gov/common/purchasing/Independent%20Audit%20Services%20Buncombe%20County%20FY24%20RFP.pdf) | 171 | 2 |
| 3 | Typical PBC list for a December 31, 2018 year end | National American Indian Housing Council, IFM training manual section 8 | [PDF](https://naihc.net/wp-content/uploads/2020/08/IFM-SEC-8-PBC-Prepared-By-Client-List.pdf) | 33 | 1 |
| 4 | Agency Purchasing Card Program agreed-upon procedures, rev. July 1, 2025 | South Carolina Division of Procurement Services | [PDF](https://procurement.sc.gov/files/P-Card_AUPs_AC_7-1-25.pdf) | 9 | 2 |
| 5 | Items town staff prepare for the auditor, FYE June 30, 2026 | Town of Holly Springs, NC, audit RFP 2026-0306 (February 2026) | [PDF](https://hollyspringsnc.gov/DocumentCenter/View/54460/RFP-2026-0306-Audit-Services) | 31 | 0 |
| | **Total** | | | **375** | **8 (2%)** |

Only list 1 was written by an auditor for a real engagement. List 2 is a county's own summary of what its auditors ask for. Lists 3 and 4 are templates, and list 5 is a town describing what it hands over. We found no publicly posted list with transaction selections in it.

Each case is in `public/samples/corpus/real/<NN-name>/`, with the file, an `expected.json` that covers every request, and the source URL. For lists 2 to 5 we kept only the pages that hold the list, copied unchanged with pdf-lib; list 1 is the whole original file. Each `about` field says which items were judgment calls.

We also looked at three more and left them out. The Foraker Group's nonprofit audit checklist says "ask permission before copying or distributing". The Ohio Auditor of State's community school checklist was not reachable from our network. A Kansas audit checklist is a list of the auditor's own steps, not requests to the client.

## How we scored

- `expected.json` was written from the source text before either parser ran. After reading the model's output we changed two of our answers: NAIHC 1.c and UC FSF-07 both run "through" the fieldwork date, so they now have no end date, the same as NAIHC 7.b already did.
- Rules parser: `npm run eval:parser -- --dir public/samples/corpus/real`, run locally.
- Model: the live app (https://tickmark-eta.vercel.app, gpt-5.5) on October 29, 2026. Each PDF was posted to `/api/parse`, which is the same call the upload screen makes. That call only reads the list. Nothing was run.
- Matching: a request counts as found when the parser returned the same ref, ignoring case, punctuation and zero padding (so `PBC-01` matches `1` and `General-1` matches `General 1`). If the refs don't match but the parser returned the same number of requests, we match by position, as `eval-parser.ts` does. Type, period and threshold scores are out of every expected request, so a request that wasn't found counts as wrong. A period is right only when both dates are right.

## Scores

| List | Parser | Returned | Found | Type | Period | Threshold | Ramp types right |
|------|--------|---------:|------:|-----:|-------:|----------:|-----------------:|
| 1 UC Hastings (131) | rules | 2 | 0 | 0 | 0 | 0 | 0/3 |
| | model | timed out | | | | | |
| 2 Buncombe (171) | rules | 0 | 0 | 0 | 0 | 0 | 0/2 |
| | model | timed out | | | | | |
| 3 NAIHC (33) | rules, main | 54 | 0 | 0 | 0 | 0 | 0/1 |
| | rules, this branch | 42 | 33 | 33 | 30 | 33 | 1/1 |
| | model | 35 | 33 | 31 | 23 | 33 | 0/1 |
| 4 SC P-Card (9) | rules (same on main) | 31 | 9 | 5 | 9 | 8 | 1/2 |
| | model | 9 | 9 | 7 | 9 | 8 | 2/2 |
| 5 Holly Springs (31) | rules, main | 31 | 31 | 31 | 0 | 31 | n/a |
| | rules, this branch | 31 | 31 | 31 | 30 | 31 | n/a |
| | model | 34 | 31 | 31 | 25 | 31 | n/a |

On the three lists both parsers could read (73 requests):

| | Found | Type | Period | Threshold | Extra rows |
|---|---:|---:|---:|---:|---:|
| Rules, main | 40 (55%) | 36 (49%) | 9 (12%) | 39 (53%) | 107 |
| Rules, this branch | 73 (100%) | 69 (95%) | 69 (95%) | 72 (99%) | 62 |
| Model (gpt-5.5) | 73 (100%) | 69 (95%) | 57 (78%) | 72 (99%) | 5 |

Across all 375 requests, the rules parser finds 73 (19%) on this branch, up from 40 (11%) on main. The fixes were made after looking at these lists, so the branch numbers are not a blind score; the main numbers are. Most "extra rows" from the rules parser are sub-items that it splits into their own requests (SC step 3's a–m fields). In Holly Springs it numbers every section from PBC-01, so its 31 rows are matched by position and none of their refs count as matches.

Output of `npm run eval:parser -- --dir public/samples/corpus/real` (rules only, exact refs):

```
Corpus: 5 cases, 375 requests

field                    rules
found           19.5% (73/375)
ref             11.2% (42/375)
type            18.4% (69/375)
period_from     18.7% (70/375)
period_to       18.4% (69/375)
min_amount      19.2% (72/375)
selections      19.5% (73/375)
extra refs                  64
```

The generated and blind corpus is still at 100% (170/170) on every field.

## What this says

- **Ramp can answer 8 of the 375 requests (2%).** Real year-end lists are mostly about the ledger, bank, payroll, debt, grants and revenue. The Ramp-answerable items are subsequent disbursements, legal invoices over a threshold, a card population scan and a card sample.
- **The live app cannot read a long list.** Lists 1 (131 items) and 2 (171 items) returned HTTP 504 `FUNCTION_INVOCATION_TIMEOUT` after 120 seconds, twice each, so the model has no score on them. A real year-end PBC list is often this long.
- **The rules parser cannot read a PDF table or an unnumbered list.** In list 1, every row starts with other columns ("FS/C-YE 01-General Items Y_PBC") before the ID. List 2 is plain titles under headings, with no numbers or bullets. Both come out empty.
- **On the lists both parsers read, they classify equally well (69/73 types).** The model is weaker on periods: it reads "as of December 31, 2018" as that one day, while the corpus convention is the fiscal year ending that day.

## Every miss

**1 UC Hastings**
- Rules, all 131: not found. This is a PDF table, and no line starts with a request marker; the parser returned 2 junk rows made of joined text.
- Model, all 131: no result, because the request timed out at 120 s.

**2 Buncombe County**
- Rules, all 171: not found. No line has a number or bullet, so the free-text splitter finds no requests.
- Model, all 171: no result, because the request timed out at 120 s.

**3 NAIHC**
- Rules 1.c, period: "through the scheduled date of the fieldwork" was read as FY2018, not open-ended.
- Rules 7.b, period: "from 12/31/2018 to the date of the audit fieldwork" was read as FY2018, not open-ended.
- Rules 11.a, period: "FY2017's ... to FY2018's" took the first year mentioned (FY2017).
- Rules, 9 extra rows: the intro line "2) Prepared By Client List." and the SEFA guidance on page 3 (1), 2), a.–d.).
- Model 7.a, type: an aged A/P listing came back as bill_support; it is a balance report.
- Model 7.b, type: checks written after year end (subsequent disbursements) came back as unsupported.
- Model 2.a, 2.c, 4.a, 7.a, 8.a, 8.e, 10.a, period: "as of December 31, 2018" was read as that single day. This is our convention against a fair reading.
- Model 1.a, period: a comparative trial balance at 12/31/2017 and 12/31/2018 was read as 2017-12-31 to 2018-12-31.
- Model 2.b, period: "January 31, 2018 bank statements" was read as that day, as written. We scored FY2018, which is arguable.
- Model 11.a, period: it spans FY2017 to FY2018; we scored FY2018.
- Model, 2 extra rows: the SEFA guidance on page 3.

**4 SC P-Card AUP**
- Rules PBC-02, type: a summary of card spend by month came back as transaction_support, because "select ... statements" reads like a sample.
- Rules and model PBC-03, type: a listing of all card transactions came back as transaction_support. Tickmark has no type for a plain listing, so we scored it unsupported. This is a judgment call.
- Rules and model PBC-07, type: the list of blocked merchant codes came back as control_testing. It is configuration, so we scored it unsupported. This is a judgment call.
- Rules PBC-08, type: unsupported. The test wording is in sub-items i and ii, which the parser splits into their own rows, so the step itself has only a title.
- Rules and model PBC-06, threshold: missed. "greater than:" ends one line and "a. $2500" starts the next.
- Rules, 22 extra rows: the sub-items 3 a–m, 6 i–v and a–b, and 8 i–ii.

**5 Holly Springs**
- Rules, refs: numbering restarts at 1 in each of the 8 sections, so refs come out as PBC-01 eight times. They are matched by position. No parser can produce our refs ("General 1") exactly.
- Rules Grants 5, period: FY2025. The PDF has no blank line after the list, so the RFP's next table ("Total dollar amount of FY25 levy") was joined onto the last item.
- Model General 4, Cash and Investments 3, Receivables 1–3 and Long-Term Debt 1, period: "as of fiscal year end" and "as of the audit date" were read as the single day 2026-06-30.
- Model, 3 extra rows: the three sentences before the list ("The general ledger will be fully balanced.").

## What we fixed in the rules parser

Each fix is general and has a test in `tests/parse.test.ts`. There are 11 new tests: 9 fail on main, and the other 2 check that existing behavior is kept (outstanding checks stay unsupported, and a numbered request with text of its own keeps its parts).

1. "year ended" split across a line break ("for the year\nended December 31, 2018"), which is common in PDF text.
2. "a December 31, year-end" with a comma is now read as the fiscal year end.
3. A month range with a comma before the year ("Jan – Mar, 2019").
4. A year end stated anywhere in the document ("the fiscal year ending June 30, 2026") now sets the document-wide period, instead of the first period phrase. In list 5 that first phrase was "FY25" in a statistics table.
5. A numbered line that is only a short heading ("4. Accounts Receivable:") followed by lettered items now gives refs 4.a, 4.b. The heading becomes the item's area, so a section like "Accrued Payroll Liabilities" also marks its items as outside Ramp. A numbered request with text of its own keeps its lettered parts as before.
6. "aged A/P" and "AP aging" are now outside Ramp. These are balance reports, not bill support.
7. "checks written", "checks issued" and "check register" now count as disbursements (bill_support).

`real/` is left out of the corpus test (which requires every field to match) and out of the default `npm run eval:parser`, so it is scored only with `--dir`.

## Not fixed

These need more than a small rule:
- Reading PDF tables (list 1) and unnumbered title lists (list 2).
- Open-ended periods ("to the date of fieldwork") and thresholds that wrap onto the next line.
- The model timeout on long lists. This is in `src/app/api/parse` and `src/lib/parse/claude.ts`, which were out of scope here; chunking the list or streaming would fix it.
- Tickmark has no type for "list every card transaction" or "list every active card with its limits" (SC steps 3 and 6), although Ramp holds both.

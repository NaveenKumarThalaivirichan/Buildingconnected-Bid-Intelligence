---
name: bid-analysis
description: Analyze and compare construction bids for a BuildingConnected bid package in this project. Use when asked to rate, rank, compare, level, or recommend bids, review scope gaps, exclusions, or price spread, draft follow-up questions for bidders, or change how the app's AI analysis (aiAnalysis.js, the AI analysis tab, the bids table) works.
---

# Bid analysis

This project is a local Node.js app that pulls BuildingConnected bids for a bid package and uses the Claude Code CLI to rate each bid and recommend an award. This skill captures how bids are analyzed here, so manual analysis and code changes stay consistent with the app.

## When to use

- The user asks to compare, rate, rank, or recommend among bids (pasted JSON, an export, or output from `GET /api/bid-packages/:id/bids`).
- The user wants scope gaps, exclusions, risks, or bidder follow-up questions.
- The user wants to change the analysis prompt, schema, rating logic, or the views that show results.

## Data model

Each bid comes from BuildingConnected v2 `/bids`, then `server.js` enriches it.

| Field | Meaning |
|---|---|
| `id` | Bid id. The AI result is merged back onto bids by this id. |
| `bidderCompanyId` / `bidderCompanyName` | `bidderCompanyId` is an office id. The name falls back to the id if lookup fails (it did for both companies in the latest run). |
| `total`, `leveledTotal` | Raw bid amount, and the amount after scope leveling. |
| `submittedAt`, `status` | `status` is derived: `SUBMITTED` if `submittedAt` is set, else `DRAFT`. |
| `revision`, `submittedByName`, `notes` | Revision number, submitter, free-text notes. |
| `lineItems` | Typed items, possibly wrapped as `{ results: [...] }`. |
| `plugs` | Leveling adjustments, each `{ id, value, amount, createdBy, … }`. Seen on live data (5 plugs totaling $650,500 on one bid). Not yet sent to the model. |

Typed line items (`type`, `description`, `value`). Live data has now shown all of these:

| `type` | Meaning | Real `section` value |
|---|---|---|
| `COST_BREAKDOWN` | Priced cost items. | none |
| `INCLUSION` | Yes/no scope questions. A value of `NO` or `false` is an exclusion. | none |
| `ALTERNATE` | Priced alternates. | none |
| `ADDENDUM` | Addendum acknowledgments. | none |
| `SCOPE_CLARIFICATION` | Free-text exceptions (Scope of Work, Electrical Installation Conditions, Warranty Conditions). | question title, or none |
| `ACKNOWLEDGMENT` | Tender Document Review, Project Scope Acceptance, Safety Requirements. | question title |
| `BONDING` | Bid Bond, Performance Bond, Bond Premium Rate. | question title |
| `CERTIFICATION` | Business Registration, ISO 9001 Certification, Safety Compliance Certification. | question title |
| `DISCLAIMER` | Tender Price Validity, Unforeseen Site Conditions, Scope Variation. | question title |
| `MARKUP` | Contractor Overhead, Profit Markup, Change Order Markup. | question title |
| `LABOR_RATE` | General Construction Worker, Skilled Electrician, Site Supervisor. | question title |

For the project-form types, `section` holds the individual question title, not the tender-form section name. Don't expect a section header there.

## Tender forms and sections

A bid answers two tender forms. Each section holds many line items, and the app tags every item sent to the model with `tenderForm` and `tenderSection`. Review a bid section by section.

| Tender form | Sections |
|---|---|
| **Project tender form** | General acknowledgement, Bond information, Fees and markups, Labor rates, Certifications, Additional information, Disclaimers and clarifications |
| **Package-specific tender form** | Line items, Other cost questions, Alternates, Inclusions, Package-specific information and unit costs, Package-specific clarifications |

How items are placed (`classifyLineItem()` in `aiAnalysis.js`): match the item's `section` text against `SECTION_RULES` first, then fall back to `type`. For the project-form types the real `section` is a question title, so `type` is the reliable signal. Anything else is `Unclassified`.

| `type` | Falls back to |
|---|---|
| `COST_BREAKDOWN` | Line items |
| `ALTERNATE` | Alternates |
| `INCLUSION` | Inclusions |
| `SCOPE_CLARIFICATION` | Package-specific clarifications |
| `ADDENDUM`, `ACKNOWLEDGMENT` | General acknowledgement |
| `BONDING` | Bond information |
| `MARKUP` | Fees and markups |
| `LABOR_RATE` | Labor rates |
| `CERTIFICATION` | Certifications |
| `DISCLAIMER` | Disclaimers and clarifications |

All 25 real item type and title combinations seen in a 14-bid test package classify correctly. Two sections, Additional information and Package-specific information and unit costs, have no item type of their own and appear only if their `section` text matches a pattern. Other cost questions is the same. They were absent from every bid in testing, so those patterns are still unverified.

## Method

1. **Choose the comparison price.** Use `leveledTotal` when it is a number, else `total`. This matches `priceOf()` in `public/js/format.js`. Don't mix the two across bids.
2. **Compute the spread and explain the leveling gap.** For each bid, give percent versus the lowest and versus the average. State the dollar and percent gap between lowest and highest. Report both `total` and `leveledTotal`, and the difference between them. In the test package the gap went in opposite directions: +$417,000 on one bid, and −$3,747,500 on the other (a $4.9M headline total against $1.16M leveled), so the raw total alone can badly mislead. How BuildingConnected computes `leveledTotal` is unconfirmed (the $650,500 of plugs doesn't account for it), so say that instead of guessing.
3. **Check scope, section by section.** For each tender-form section, count filled versus total items. List every `INCLUSION` answered `NO`, every unfilled item, any clarification or disclaimer text, and unacknowledged addenda. Name the section when citing a gap. If a section is absent from every bid, say so instead of assuming it was answered (in the latest run, Other cost questions and Package-specific information and unit costs were absent from every bid). Compute item prices as `unitCost` × `quantity` where both exist.
4. **Cross-check answers against prices.** A `NO` inclusion that is still priced in Line items is a conflict to raise before award. Live example: Wall Painting and Equipment Rental were answered `NO` while $125,000 and $48,000 were priced. Also verify that Line items sum to `total` (it matched on both current offers in testing).
5. **Check risk.** Compare unit rates, markups (profit, overhead, change order), bond rate and premium, certifications, warranty and price validity. Look for exclusions, ambiguous or missing information, draft status, and an unusually low price that coincides with scope gaps. Treat these answers as risks: NO to Project Scope Acceptance, NO to ISO 9001, a higher bond rate or premium than the competitor (live example: 5% bid bond and 1.5% premium against 2% and 0.75%), and a capped scope (live example: electrical capped at 5,000 W). Note when unit rates run consistently below the other bidder's, and when notes say prices are negotiable.
6. **Collapse revisions.** Several bids can come from one company (13 of 14 in a test package). Treat the latest `submittedAt` as the current offer and the others as earlier revisions. Don't present them as competing bidders, and lower confidence when there is little real competition.
7. **Rate each bid 1–5, relative to the set.** 5 is the best choice in this set, 1 is the worst. Don't give every bid the same score unless they are genuinely equivalent. The best bid in a weak set can still be a 5. Superseded revisions are history: rate them low or flag them as superseded (the latest run gave all twelve old revisions a 1).
8. **Recommend one bid.** Set confidence to `HIGH`, `MEDIUM`, or `LOW`. Thin or missing scope data lowers confidence, not just close pricing. End with the conditions under which the pick holds (for example, "best pick on price and flexibility, provided the scope acknowledgment and exclusions are resolved before award"). Also say when the pick is wrong (for example, "not the right pick if ISO certification or a low bond cost is a hard requirement").

## Edge cases

- **No bids:** report there is nothing to analyze.
- **One bid:** don't rate it. Say there is nothing to compare against (the app sets `aiRating: null`).
- **Missing prices:** exclude those bids from price math and say so.
- **Draft bids:** flag them. They haven't been formally submitted.
- **Capped line items:** the app sends at most 200 line items per bid. Say so if the analysis may rely on truncated data.
- **Unresolved company names:** the lookups can 404, so a bidder may be an id. Use the id (or a short prefix, such as `68d8ffc3`) consistently.

## Output contract

When producing analysis for the app, match the schema in `aiAnalysis.js` (`ANALYSIS_SCHEMA`) exactly:

```json
{
  "analyses": [{ "id": "…", "rating": 1, "analysis": "…" }],
  "summary": {
    "recommendedBidId": "…",
    "confidence": "LOW | MEDIUM | HIGH",
    "rationale": "…",
    "priceSpread": "…",
    "risks": [],
    "strengths": [],
    "scopeGaps": [],
    "followUpQuestions": []
  }
}
```

- **Per-bid `analysis`:** 6–10 sentences covering price positioning in dollars and percent, scope completeness, risk factors, and when the bid is or isn't the right pick. Cite real numbers and notes. No generic filler.
- **`rationale`:** 2–3 sentences on why the winner wins, with numbers.
- **`priceSpread`:** one sentence with the dollar and percent gap between lowest and highest.
- **`risks`, `strengths`, `scopeGaps`, `followUpQuestions`:** 3–6 short strings each, or `[]` if there is genuinely nothing notable. Name the bidder when a gap is specific to one. Follow-up questions must come from the gaps found, not procurement boilerplate.

For a manual (non-app) request, present the same content as a short markdown report: recommendation and confidence first, then a price table, then risks, gaps, and questions. Always remind the reader that the analysis is AI-generated and should be verified before award.

## Code map

When changing the analysis, edit in this order:

- `aiAnalysis.js`: prompt (`buildAnalysisPrompt`), schema, line-item compaction, section classification, and the `claude -p` subprocess call.
- `server.js`: `GET /api/bid-packages/:id/bids` fetches, enriches, then calls `attachAiAnalysis()`.
- `public/js/format.js`: `priceOf`, `computeComparisons`, `summarizeScope`, and the color thresholds.
- `public/js/views/aiAnalysis.js` and `bids.js`: where results render.

## How the app uses this file

`buildAnalysisPrompt()` in `aiAnalysis.js` reads this file at runtime (frontmatter removed) and puts it in every analysis prompt inside `<bid_analysis_guide>` tags. So edits here change the app's behavior immediately, with no restart. Keep it accurate and reasonably short, because it is sent with every request. Sections about changing the code (Code map, Project conventions, open items) ride along as context, and the prompt tells the model to ignore them as instructions.

## Project conventions

- Pass all API-sourced text through `escapeHtml()` before `innerHTML`.
- Views navigate through `state.js`, never by importing each other.
- No build step and no SDK. The app shells out to the logged-in `claude` CLI, with the prompt on stdin.
- After editing `aiAnalysis.js` or `server.js`, run `npm run check` and restart the server. Test against a package with two or more bids, because one bid skips the AI call.
- The analysis tab is read-only. The app never writes to BuildingConnected.

## Test findings and open items

From a test run (package "Test Tender Package", 14 bids, two companies: 68d8ffc3 with revisions 0–12, and 5430e7bc with one bid). Both current offers rank on leveled price at $1,105,000 (68d8ffc3, rev 12) and $1,157,000 (5430e7bc).

**Fixed**

- Line items lost `type`, `value`, `unitCost` and `section`. `LINE_ITEM_KEYS` now matches the real shape. Keep them if you touch the whitelist.
- Notes carried raw HTML. `stripHtml()` cleans them.
- Project-form items (acknowledgments, bonds, markups, labor rates, certifications, disclaimers) were left `Unclassified`. `TYPE_FALLBACK` now covers every type.
- Same-company revisions were treated as separate bidders. The prompt now says to treat the latest `submittedAt` as current. In the latest run the model named the latest 68d8ffc3 bid as the pick and called the other 13 superseded or earlier revisions.
- The earlier gaps about unseen line item types and unseen `plugs` are closed: both now appear in live data.
- Per-bid line item pagination isn't a problem for this data: no bid had more than 48 items.

**Open**

- **Plugs not sent to the model.** `summarizeBidForAnalysis()` omits `plugs`, and they are material ($650,500 on one bid).
- **`leveledTotal` mechanism unknown.** Documented only by its effect. Confirm against BuildingConnected docs before encoding a rule.
- **No 5-star rating given.** Ratings were 2, 4 and twelve 1s, so the recommended bid got a 4 although the prompt says the best bid in a set can be a 5. Consider telling the model that the recommended bid should hold the top rating in the set.
- **Name lookups still 404.** `GET /offices/:id`, `/companies/:id` and `/users/:id` failed for both companies and one user, so the model saw ids as names. Likely a scope or permission limit.
- **Nested pagination not followed in code.** `fetchAllPages()` only follows the top-level bids list. Not triggered by this data, but a bid with many items could be cut off.
# BuildingConnected bid intelligence

Compare construction bids faster. This local Node.js app connects to your BuildingConnected account, lets you browse **projects → bid packages → bids**, and uses your locally installed **Claude Code CLI** to rate every bid and recommend which one to award. It needs no Anthropic SDK and no API key.

## The problem it solves

Comparing bids for one package means opening each submission, reading line items and exclusions, and working out price gaps by hand. This tool pulls every bid for a package into one view, calculates how each compares with the lowest and average price, and produces a ranked, evidence-based recommendation. The reviewer makes the final call, with the supporting data one click away.

## Contents

[Features](#features) · [Quick start](#quick-start) · [Configuration](#configuration) · [How AI analysis works](#how-ai-analysis-works) · [The bid-analysis skill](#the-bid-analysis-skill) · [Architecture](#architecture) · [API routes](#api-routes) · [Security](#security) · [Development](#development) · [Limitations](#limitations) · [Troubleshooting](#troubleshooting)

## Features

- **Autodesk sign-in.** APS three-legged OAuth, with in-memory tokens and automatic refresh.
- **Project and package browsing.** Search projects, and see due-date and bid-count badges (overdue and due-soon highlighting) on each bid package.
- **Package workspace with three tabs:**
  - **Overview:** due dates, estimated cost, instructions, and award details if the package has been awarded.
  - **Bids:** sortable, filterable comparison table with a slide-over drawer for full bid detail.
  - **AI analysis:** package-level recommendation plus a per-bid written analysis.
- **Relative AI rating.** Each bid gets a 1–5 star rating compared against the other bids in the package, so scores differentiate instead of clustering.
- **Readable names.** Bid packages, projects, bidder companies, and submitters resolve to real names, falling back to raw IDs if a lookup fails.
- **Skill-driven analysis.** The analysis method, rating rules and project knowledge live in one editable file, `.claude/skills/bid-analysis/SKILL.md`, which the app sends to the model with every request (see [The bid-analysis skill](#the-bid-analysis-skill)).
- **Smart caching.** The frontend shares one in-flight AI request across tabs, so switching between Bids and AI analysis never re-runs the slow comparison.

### What you see when the analysis completes

While the analysis runs, the tab shows "Fetching bids…" and then "Running AI analysis on each bid…". When it finishes, the UI shows the following.

**AI analysis tab**

| Section | What it shows |
|---|---|
| **Recommended bidder** | The top pick (company name and ID), a confidence badge (**High**, **Medium**, or **Low**), the star rating, the bid amount, and the percent versus the lowest bid. |
| **Rationale** | Two to three sentences explaining why that bid wins, citing actual numbers. |
| **Price spread** | One sentence quantifying the dollar and percent gap between the lowest and highest bid. |
| **Price comparison** | A horizontal bar chart of every bid's price, with the recommended bid in green and labeled **Recommended**. |
| **Risks** | The most important risks across the whole set that a reviewer should know before awarding. |
| **Strengths** | The strongest positive differentiators across the set. |
| **Scope gaps and missing items** | Missing items, unanswered fields, or ambiguous scope, naming the bid or company where relevant. |
| **Suggested follow-up questions** | Concrete questions to ask bidders before awarding, based on the gaps and risks found. |
| **Per-bid analysis** | An accordion with one entry per bid, sorted by rating (highest first) and showing its stars. The top bid opens by default. Each entry has a 6–10 sentence analysis covering price position, scope completeness, risk factors, and when the bid is or isn't the right pick. |
| **Disclaimer** | A reminder that ratings and analysis are AI-generated and should be verified independently. |

An empty list shows "Nothing notable flagged" instead of filler.

**Bids tab (after analysis)**

- **Comparison table columns:** bidder (revision, ID, and submitter), status badge (`SUBMITTED` or `DRAFT`), amount, percent versus lowest, percent versus average, submitted date, scope (for example, "Cost items 1/3"), exceptions (truncated, or "None stated"), AI star rating, and a **Details** button.
- **Color coding:** the best-rated bid's row is highlighted green, the priciest bid's row is flagged (only when prices differ), and the percent columns are color-coded.
- **Toolbar:** filter by bidder name, and sort by price (low to high or high to low) or by rating (high to low). Filtering and sorting never change what counts as "lowest" or "best", because those are calculated against the full set.

**Bid details drawer**

Click **Details** on any row to open a slide-over (close it with the button, the backdrop, or `Esc`). It shows the AI rating, status, total, leveled total, submitted by, revision, submitted date and time, and bid package name, followed by the full AI analysis and the exceptions and exclusions text.

**Fallback states**

- **One bid only:** a note that there is nothing to compare, with no rating.
- **No bids:** an empty-state message.
- **AI failure or timeout:** the readable error replaces each bid's analysis, ratings are blank, and the BuildingConnected data still displays.

## Quick start

**Prerequisites**

- Node.js 18 or later (Express 4 and global `fetch`)
- An Autodesk Platform Services (APS) app with BuildingConnected API access
- The [Claude Code CLI](https://claude.com/claude-code), installed, on your `PATH`, and logged in (`claude /login`). It's required only for AI analysis. Without it, the rest of the app works and bids show an "AI analysis unavailable" message.

**Steps**

1. Register an app at [aps.autodesk.com/myapps](https://aps.autodesk.com/myapps) if you don't have one. Set its callback URL to `http://localhost:3737/api/oauth/callback`.
2. Copy `.env.example` to `.env` and add your `APS_CLIENT_ID` and `APS_CLIENT_SECRET`.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the server:
   ```bash
   npm start
   ```
5. Open `http://localhost:3737` and sign in with Autodesk.

## Configuration

Set these in `.env`. The server refuses to start if a required variable is missing.

| Variable | Required | Description |
|---|---|---|
| `APS_CLIENT_ID` | Yes | APS app client ID. |
| `APS_CLIENT_SECRET` | Yes | APS app client secret. |
| `APS_CALLBACK_URL` | Yes | Must exactly match a callback URL registered on the APS app. The server listens on `/api/oauth/callback`. |
| `APS_SCOPES` | No | OAuth scopes. Defaults to `data:read`. |
| `PORT` | No | Local port. Defaults to `3737`. |
| `HOST` | No | Interface to listen on. Defaults to `127.0.0.1` (this machine only). |

> **Keep secrets out of version control.** `.gitignore` excludes `.env`. Commit only `.env.example`.

## How AI analysis works

When you open a package's **Bids** or **AI analysis** tab, `GET /api/bid-packages/:id/bids` fetches the bids, resolves names, and calls `attachAiAnalysis()` in `aiAnalysis.js`. That function runs:

```
claude -p --permission-mode dontAsk --output-format json --json-schema '<schema>' --strict-mcp-config
```

- **Prompt over stdin.** Windows limits a command line to 32,767 characters, and large packages can exceed that. Piping the prompt through stdin avoids the limit.
- **Structured output.** `--json-schema` forces the reply into `{ analyses: [{ id, rating, analysis }], summary: {...} }`. The app reads it from the `structured_output` field and merges it onto each bid by `id`.
- **No SDK, no API key.** The app reuses your logged-in `claude` session through Node's `child_process`. The model is whatever your CLI session or plan defaults to. The app doesn't pin one.

**What the model sees.** Only `id`, `bidderCompanyName`, `total`, `leveledTotal`, `notes` (HTML stripped), `submittedAt`, and a compacted `lineItems` array (capped at 200 items). Each item keeps `type`, `section`, `code`, `description`, `quantity`, `unit`, `unitCost`, `value`, `isRequired` and `isCustom`. Attachments and internal BuildingConnected metadata are never sent.

**Tender forms and sections.** A bid answers two tender forms, each with several sections that hold many items. The app tags every item with `tenderForm` and `tenderSection`, and the prompt tells the model to compare bids section by section.

| Tender form | Sections |
|---|---|
| **Project tender form** | General acknowledgement, Bond information, Fees and markups, Labor rates, Certifications, Additional information, Disclaimers and clarifications |
| **Package-specific tender form** | Line items, Other cost questions, Alternates, Inclusions, Package-specific information and unit costs, Package-specific clarifications |

Items are placed by matching their `section` text against `SECTION_RULES` in `aiAnalysis.js`, then by `type`. Anything that matches neither is labeled `Unclassified`.

Live data includes every item type (`COST_BREAKDOWN`, `INCLUSION`, `ALTERNATE`, `ADDENDUM`, `SCOPE_CLARIFICATION`, `ACKNOWLEDGMENT`, `BONDING`, `CERTIFICATION`, `DISCLAIMER`, `MARKUP`, `LABOR_RATE`). For the project-form types, `section` holds the individual question title (for example, "Bid Bond" or "Skilled Electrician"), not the section name, so each type also has a fallback to its tender-form section. Items that match neither a pattern nor a type are labeled `Unclassified`.

**Revisions.** If several bids come from one company, the model treats the latest `submittedAt` as the current offer and the rest as earlier revisions. In a 14-bid test package, 13 of 14 bids were revisions from one company. The model picked that company's latest bid and rated the superseded ones 1.

**Leveled total.** The model compares on `leveledTotal` when present and reports the raw `total` alongside it. The two can differ a lot (in the test package, a $4.9M total leveled to $1.16M). The app doesn't compute `leveledTotal`. It comes from BuildingConnected.

**Failure handling.**

| Situation | Result |
|---|---|
| One bid in the package | No AI call. The bid gets a placeholder note. |
| `SKILL.md` missing or unreadable | A warning prints to the console and the analysis runs on the built-in prompt alone. |
| `claude` missing, not logged in, 180-second timeout, or malformed response | The error is printed to the server console, and every bid shows a readable fallback message (`aiRating: null`). |

BuildingConnected data is never blocked by the AI step.

## The bid-analysis skill

`.claude/skills/bid-analysis/SKILL.md` is the single source of truth for how bids are analyzed and for how this project works. The app doesn't hard-code that knowledge in the prompt. It loads this file and sends it to the model.

**How the app uses it**

1. On every analysis, `buildAnalysisPrompt()` in `aiAnalysis.js` calls `loadSkillGuide()`, which reads `SKILL.md` from disk.
2. It strips the YAML frontmatter (routing metadata for Claude Code, not guidance) and wraps the rest in `<bid_analysis_guide>` tags.
3. The prompt puts the guide right after the opening instruction, then the built-in instructions, then the bid data. The prompt tells the model to follow the guide for method, rating rules, edge cases and output format, to use it to interpret the data, and to ignore the sections about changing code. If the guide and the built-in instructions conflict, the built-in instructions win.
4. The model replies with the same JSON schema as before, so nothing downstream changes.

The file is read on each call, so edits take effect on the next analysis without restarting the server. If it's missing or unreadable, a warning prints to the console and the analysis falls back to the built-in prompt.

**What it contains**

| Section | Purpose |
|---|---|
| Data model | Bid fields, the 11 line item types, and what `plugs` and `leveledTotal` are. |
| Tender forms and sections | The two tender forms, their sections, and how items are classified. |
| Method | Eight steps: choose the comparison price, explain the leveling gap, check scope by section, cross-check answers against prices, check risk, collapse revisions, rate relative to the set, recommend with conditions. |
| Edge cases | No bids, one bid, missing prices, drafts, capped line items, unresolved names. |
| Output contract | The JSON schema and the length and content rules for each field. |
| Code map and conventions | Where to change things. Sent to the model as context only. |
| Test findings and open items | Known gaps from test runs. |

**Two uses, one file**

- **In the app:** the model reads it for every analysis, as above.
- **In Claude Code:** the file is also a project skill (`bid-analysis`). When you work in this folder and ask to compare bids, review scope gaps, or change the analysis, Claude Code loads it automatically, so manual analysis and code changes follow the same rules as the app.

**Editing it**

- To change how bids are rated or what the analysis covers, edit `SKILL.md`. Keep the Output contract in step with `ANALYSIS_SCHEMA` in `aiAnalysis.js`, because the schema is what the CLI enforces.
- Keep it accurate and short. It's sent with every request and adds roughly 5,000 tokens, so a longer file makes each analysis slower and costlier.
- Keep the frontmatter (`name`, `description`). Claude Code needs it, and the app strips it.
- Test after changes with a package of two or more bids. A single bid skips the AI call and never reads the skill.
## Architecture

The backend is deliberately small. The frontend is plain ES modules with no framework and no build step.

```
server.js             Express app: OAuth, BuildingConnected API calls, routes
aiAnalysis.js         Claude CLI subprocess: builds the prompt, spawns `claude`, parses output,
                      classifies line items into tender-form sections
package.json          Dependencies, Node version requirement, npm scripts
.env.example          Template for required environment variables
.gitignore            Keeps .env and node_modules out of version control
.editorconfig         Shared editor settings (UTF-8, LF, 2-space indent)

.claude/skills/bid-analysis/SKILL.md
                      Skill file: analysis method and project knowledge, read by the app at runtime

public/
  index.html          Page shell (login screen, app shell, shared drawer markup)
  styles.css          All styles
  js/
    main.js           Entry point: login/logout wiring, top-level render dispatch
    state.js          Navigation state and per-package caches
    api.js            Every fetch() call to the backend
    format.js         Currency, dates, status badges, scope summaries
    breadcrumb.js     Projects / Project / Bid package breadcrumb trail
    drawer.js         Bid-detail slide-over shared by the Bids and AI analysis tabs
    views/
      projects.js     Projects grid with search
      bidPackages.js  Bid packages list (due dates, bid counts)
      workspace.js    Package header and tab bar
      overview.js     Overview tab
      bids.js         Bids tab: comparison table, sort/filter, bid and AI fetch/cache
      aiAnalysis.js   AI analysis tab: recommendation, risks, strengths, gaps, per-bid accordion
```

**Design choices**

- `server.js` holds all backend routes in one file, because the app is too small to benefit from extra layers. The `authedRoute()` wrapper gives every data route the same sign-in check and error handling, so a route contains only its own logic.
- `aiAnalysis.js` is separate because subprocess management is a distinct concern with its own error handling.
- Views never import each other. They navigate through `state.js` and a single render dispatcher in `main.js`, which avoids circular imports.

## API routes

| Route | Purpose |
|---|---|
| `GET /api/oauth/login` | Starts the Autodesk OAuth flow. |
| `GET /api/oauth/callback` | Completes OAuth and stores the token. |
| `GET /api/auth/status` | Returns `{ authenticated }`. |
| `POST /api/auth/logout` | Clears the token. |
| `GET /api/projects` | Lists the current user's projects. |
| `GET /api/projects/:projectId/bid-packages` | Lists a project's bid packages. |
| `GET /api/bid-packages/:id/bids` | Returns enriched bids plus the AI summary. |
| `GET /api/bid-packages/:id/bids/count` | Returns the bid count only (no AI cost), used for list badges. |

## Security

- **Local only by default.** The server binds to `127.0.0.1`, so other machines on the network can't reach it. The API has no login of its own, so don't change `HOST` without adding authentication.
- **OAuth `state` check.** Each sign-in generates a random `state` value, and the callback rejects any response that doesn't match it.
- **Read-only access.** The default scope is `data:read`. The app never writes to BuildingConnected.
- **Secrets stay server-side.** The client secret is only used in the backend token exchange. Tokens live in memory and are never written to disk.
- **Output escaping.** All API-sourced text goes through `escapeHtml()` before it reaches `innerHTML`.
- **Minimal AI exposure.** Only the whitelisted bid fields listed above, plus the contents of `SKILL.md`, are sent to the model. Don't put secrets or customer data in `SKILL.md`.

## Implementation notes

- **Pagination.** `fetchAllPages()` follows `pagination.nextUrl` (or `next`/`nextPage`) until exhausted, so lists are never silently truncated.
- **Best-effort enrichment.** `tryGetJson()` swallows errors and returns `null`, so a failed name lookup shows the raw ID instead of breaking the request.
- **`bidderCompanyId` is an office ID.** `GET /offices/:id` is tried first, with `/companies/:id` as a fallback.
- **Derived bid status.** BuildingConnected has no explicit status field, so a bid is `SUBMITTED` if `submittedAt` is set, and `DRAFT` otherwise.

## Development

- There's no build step, watch mode, or hot reload. `npm start` runs `node server.js`.
- After editing any backend `.js` file, restart the process. `SKILL.md` is the exception: it's read on every analysis. Files in `public/` are served as-is, so refresh the browser.
- There's no automated test suite. To validate changes:
  - Run `npm run check` (syntax-checks `server.js` and `aiAnalysis.js`).
  - Start the server, then click through login → project → bid package → each tab.
  - When changing `aiAnalysis.js`, test against a package with two or more bids. A single bid skips the AI call.

**Conventions**

- Write browser-native ES modules. Don't add a bundler or transpiler without a concrete need.
- Navigate between views with `state.js` (`goTo*`/`setTab`), never by importing another view.
- Pass all user- or API-sourced text through `escapeHtml()` (`format.js`) before using it in `innerHTML`.
- Write comments that explain *why*, not *what*.

## Limitations

- **Line item pagination.** Each bid's `lineItems` carries its own `pagination` object, but only the top-level bid list is paged. A bid with many items could be cut off at the first page. The logged bids had at most 48 items, and `lineItemsTruncated` was false for all of them.
- **Plugs aren't sent to the model.** Bids carry `plugs` (leveling adjustments, $650,500 across five on one bid in testing). They're left out of the prompt.
- **Ratings can skew low.** In one test run no bid got 5 stars and every superseded revision got 1, so read ratings next to the written analysis.
- **Names can fall back to IDs.** Office, company and user lookups returned 404 in testing, so bidders can appear as raw IDs.

This is a **single-user local tool**, not a multi-user service. OAuth tokens live in one in-memory variable (`tokenStore` in `server.js`). Restarting the server signs you out, and a second concurrent user would overwrite the first user's session. Deploying beyond localhost requires per-user session storage.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Missing APS_CLIENT_ID / APS_CLIENT_SECRET / APS_CALLBACK_URL" | Copy `.env.example` to `.env` and fill in real values. |
| OAuth redirects to an error page | Make `APS_CALLBACK_URL` match the URL registered on your APS app exactly, including `/api/oauth/callback`. |
| "AI analysis unavailable: the `claude` CLI was not found on PATH" | Install the Claude Code CLI and make sure `claude` resolves in the shell that runs the server. |
| AI analysis is slow | Expected. It's a real LLM call that scales with bid and line-item count (180-second timeout). A 12-bid package took about 40 seconds, and a 14-bid package with every tender section about 60 seconds. |
| Items show as `Unclassified` | Compare the item's `type` and `section` with `SECTION_RULES` and `TYPE_FALLBACK` in `aiAnalysis.js`, then adjust them. Project-form types (`BONDING`, `MARKUP`, `LABOR_RATE` and so on) currently have no type fallback. |
| Bidders show as IDs | The office, company or user lookup returned 404 (a 404 from the BuildingConnected API). The analysis still works. |
| Port already in use | Set a different `PORT` in `.env`. |
| Code changes don't take effect | Restart the server. There's no hot reload. |

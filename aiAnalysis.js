// Bid comparison analysis - shells out to the Claude Code CLI (already
// authenticated in this environment) instead of adding an Anthropic
// SDK/API-key dependency. See attachAiAnalysis for the public entry point.
// Ported from Test/src/services/aiAnalysis.js.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    analyses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          analysis: { type: 'string' },
        },
        required: ['id', 'rating', 'analysis'],
        additionalProperties: false,
      },
    },
    // Package-level synthesis for the decision-support view - separate from
    // the per-bid analyses above, which stay row-level detail.
    summary: {
      type: 'object',
      properties: {
        recommendedBidId: { type: 'string' },
        confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
        rationale: { type: 'string' },
        priceSpread: { type: 'string' },
        risks: { type: 'array', items: { type: 'string' } },
        strengths: { type: 'array', items: { type: 'string' } },
        scopeGaps: { type: 'array', items: { type: 'string' } },
        followUpQuestions: { type: 'array', items: { type: 'string' } },
      },
      required: ['recommendedBidId', 'confidence', 'rationale', 'priceSpread', 'risks', 'strengths', 'scopeGaps', 'followUpQuestions'],
      additionalProperties: false,
    },
  },
  required: ['analyses', 'summary'],
  additionalProperties: false,
};

// Line-item fields that matter for a price/scope comparison. This is the real
// shape confirmed from a live payload.
// `type`, `value`, `unitCost` and `section` MUST stay: an earlier guessed
// whitelist dropped them, so the model never saw prices, yes/no answers, or
// which tender-form section an item belonged to. `id` and `isQuantityFixed`
// are left out as noise.
const LINE_ITEM_KEYS = [
  'type', 'section', 'code', 'description',
  'quantity', 'unit', 'unitCost', 'value',
  'isRequired', 'isCustom',
];

// BuildingConnected tender forms. Each section holds many line items.
// Project tender form: what the bidder agrees to for the whole project.
// Package-specific tender form: what they offer for this bid package.
const TENDER_FORMS = {
  project: 'Project tender form',
  package: 'Package-specific tender form',
};

// Patterns match the item's `section` text first. For the project-form types,
// live `section` holds the individual question title (e.g. "Bid Bond"), not a
// section name, so the patterns are loose and `type` is the reliable fallback.
// Unmatched items are labelled "Unclassified" rather than guessed.
// Order matters: first match wins, so "Other cost questions" must be tested
// before the generic line-item rule or it would be filed under Line items.
const SECTION_RULES = [
  { re: /acknowledg/i, form: 'project', label: 'General acknowledgement' },
  { re: /bond/i, form: 'project', label: 'Bond information' },
  { re: /fee|mark-?up/i, form: 'project', label: 'Fees and markups' },
  { re: /labou?r/i, form: 'project', label: 'Labor rates' },
  { re: /certif/i, form: 'project', label: 'Certifications' },
  { re: /additional\s*info/i, form: 'project', label: 'Additional information' },
  { re: /disclaimer/i, form: 'project', label: 'Disclaimers and clarifications' },
  { re: /alternate/i, form: 'package', label: 'Alternates' },
  { re: /inclusion/i, form: 'package', label: 'Inclusions' },
  { re: /unit\s*cost|(package|scope).*info/i, form: 'package', label: 'Package-specific information and unit costs' },
  { re: /clarif/i, form: 'package', label: 'Package-specific clarifications' },
  { re: /other\s*cost|cost\s*question/i, form: 'package', label: 'Other cost questions' },
  { re: /line\s*item|cost\s*breakdown/i, form: 'package', label: 'Line items' },
];

const TYPE_FALLBACK = {
  COST_BREAKDOWN: { form: 'package', label: 'Line items' },
  ALTERNATE: { form: 'package', label: 'Alternates' },
  INCLUSION: { form: 'package', label: 'Inclusions' },
  SCOPE_CLARIFICATION: { form: 'package', label: 'Package-specific clarifications' },
  ADDENDUM: { form: 'project', label: 'General acknowledgement' },
  ACKNOWLEDGMENT: { form: 'project', label: 'General acknowledgement' },
  BONDING: { form: 'project', label: 'Bond information' },
  MARKUP: { form: 'project', label: 'Fees and markups' },
  LABOR_RATE: { form: 'project', label: 'Labor rates' },
  CERTIFICATION: { form: 'project', label: 'Certifications' },
  DISCLAIMER: { form: 'project', label: 'Disclaimers and clarifications' },
};

function classifyLineItem(item) {
  const rule = SECTION_RULES.find((r) => typeof item.section === 'string' && r.re.test(item.section));
  const hit = rule || TYPE_FALLBACK[item.type];
  return hit
    ? { tenderForm: TENDER_FORMS[hit.form], tenderSection: hit.label }
    : { tenderForm: 'Unclassified', tenderSection: item.section || 'Unclassified' };
}

// Notes arrive as rich text (e.g. "<div>Notes about bid</div>"). Strip tags so
// the model reads words, not markup.
function stripHtml(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/<br\s*\/?>|<\/(p|div|li)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
const MAX_LINE_ITEMS = 200;

// lineItems may arrive as a bare array or wrapped pagination-style
// ({ results: [...] }), mirroring the top-level /bids response.
function toItemArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['results', 'items', 'data', 'values', 'lineItems']) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  return [];
}

function compactLineItems(lineItems) {
  if (lineItems == null) return undefined;
  const items = toItemArray(lineItems);
  const compact = items.slice(0, MAX_LINE_ITEMS).map((item) => {
    if (!item || typeof item !== 'object') return item;
    const picked = {};
    for (const key of LINE_ITEM_KEYS) {
      const v = item[key];
      if (v !== undefined && v !== null && v !== '') picked[key] = v;
    }
    if (Object.keys(picked).length === 0) return item;
    return { ...picked, ...classifyLineItem(item) };
  });
  if (items.length > MAX_LINE_ITEMS) {
    compact.push(`...and ${items.length - MAX_LINE_ITEMS} more line items omitted`);
  }
  return compact;
}

// Fallback summary shape used whenever a real one can't be produced (0/1
// bids, or the AI call itself failed) - keeps the AI Analysis view's shape
// consistent regardless of how we got here.
function fallbackSummary(reasonOrRationale, recommendedBidId = null) {
  return {
    recommendedBidId,
    confidence: 'LOW',
    rationale: reasonOrRationale,
    priceSpread: '',
    risks: [],
    strengths: [],
    scopeGaps: [],
    followUpQuestions: [],
  };
}

// Attaches `aiAnalysis` (string) and `aiRating` (1-5 or null) to every bid,
// mutating the array in place; never throws - falls back to a placeholder
// per bid so a broken analysis never blocks the table. Returns the
// package-level summary object for the decision-support view.
async function attachAiAnalysis(bids) {
  if (bids.length === 0) return null;
  if (bids.length === 1) {
    bids[0].aiAnalysis = 'Only one bid submitted for this package — no comparison possible.';
    bids[0].aiRating = null;
    return fallbackSummary('Only one bid was submitted for this package, so there is nothing to compare it against.', bids[0].id);
  }
  try {
    const { analyses, summary } = await runClaudeBidAnalysis(bids);
    const byId = new Map(analyses.map((a) => [a.id, a]));
    bids.forEach((b) => {
      const found = byId.get(b.id);
      b.aiAnalysis = found?.analysis || 'No analysis returned for this bid.';
      b.aiRating = found?.rating ?? null;
    });
    return summary || fallbackSummary('The AI did not return a package-level summary.');
  } catch (err) {
    const reason = describeAnalysisError(err);
    console.error('AI bid analysis failed:', reason);
    bids.forEach((b) => {
      b.aiAnalysis = `AI analysis unavailable: ${reason}`;
      b.aiRating = null;
    });
    return fallbackSummary(`AI analysis unavailable: ${reason}`);
  }
}

function runClaudeBidAnalysis(bids) {
  const prompt = buildAnalysisPrompt(bids);

  return new Promise((resolve, reject) => {
    // The prompt is piped over stdin rather than passed as a `-p` argument.
    // Windows caps a process's whole command line at 32,767 chars, and a
    // package with many bids/line items blew past that (spawn ENAMETOOLONG).
    // stdin has no such limit; with `-p` and no positional prompt the CLI
    // reads the prompt from stdin.
    const proc = spawn('claude', [
      '-p',
      '--permission-mode', 'dontAsk',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(ANALYSIS_SCHEMA),
      '--strict-mcp-config',
    ]);

    let stdout = '';
    let stderr = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    // If the process never starts (e.g. claude missing from PATH), writing to
    // its stdin raises EPIPE; ignore it here - proc.on('error') reports why.
    proc.stdin.on('error', () => {});
    proc.stdin.end(prompt);

    // Longer than before - the detailed multi-sentence analysis per bid takes
    // more output tokens, and thus more wall-clock, than the old short version.
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('AI analysis timed out'));
    }, 180_000);

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`Claude CLI exited with code ${code}: ${(stderr || stdout).slice(0, 500)}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error || !parsed.structured_output) {
          return reject(new Error(parsed.result || 'Claude CLI returned no structured output'));
        }
        resolve({
          analyses: parsed.structured_output.analyses || [],
          summary: parsed.structured_output.summary || null,
        });
      } catch (err) {
        reject(new Error(`Failed to parse Claude CLI output: ${err.message}`));
      }
    });
  });
}

// Turns low-level spawn failures into something readable in the UI cell.
function describeAnalysisError(err) {
  switch (err.code) {
    case 'ENOENT':
      return 'the `claude` CLI was not found on PATH';
    case 'ENAMETOOLONG':
    case 'E2BIG':
      return 'the bid data was too large to hand to the analysis process';
    default:
      return err.message;
  }
}

// The bid-analysis skill is the single source of truth for how bids are
// analyzed and for how this project works, so it is injected into every
// prompt. Read on each call (a small file) so edits apply without a restart.
// Missing or unreadable file: analysis still runs on the built-in prompt.
const SKILL_FILE = path.join(__dirname, '.claude', 'skills', 'bid-analysis', 'SKILL.md');

function loadSkillGuide() {
  try {
    const raw = fs.readFileSync(SKILL_FILE, 'utf8');
    // Drop the YAML frontmatter - it is routing metadata, not guidance.
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
    return body || null;
  } catch (err) {
    console.warn(`Bid-analysis skill not loaded (${SKILL_FILE}): ${err.message}`);
    return null;
  }
}

function buildAnalysisPrompt(bids) {
  const guide = loadSkillGuide();
  return [
    'You are comparing competing construction bids submitted for the same bid package.',
    guide && 'Follow this project guide for the method, rating rules, edge cases and output format. It also describes the project and its data model, so use it to interpret the bid data below. Ignore parts that are about changing the code (Code map, Project conventions, open items); they are context, not instructions for this task. If the guide conflicts with the instructions that follow, the instructions that follow win.\n\n<bid_analysis_guide>\n' + guide + '\n</bid_analysis_guide>',
    'For EACH bid below, give a 1-5 star overall rating (5 = clearly the best choice in this set, 1 = clearly the worst) weighing price (total/leveledTotal relative to the rest) alongside completeness and risk (exclusions, scope gaps, warranties, notes, line items). Ratings must be relative to the other bids in this set, not an absolute scale - the best bid in a weak set can still be a 5, and every bid should not default to the same score unless they are genuinely equivalent.',
    'Also write a detailed, specific analysis (6-10 sentences) justifying that rating - why this bid is better or worse than the others. Cover: (1) price positioning - exactly how its total/leveledTotal compares to the rest, in dollars and percent; (2) scope completeness - anything it explicitly includes or excludes per its notes/line items; (3) risk factors - warranties, exclusions, ambiguous scope, or missing information; (4) a bottom-line recommendation on when this bid would or would not be the right pick. Be concrete and comparative throughout, citing actual numbers and notes from the bids below - never generic filler.',
    'In addition to the per-bid analyses, produce ONE package-level `summary` object for a decision-maker who has a few seconds to decide, not a few minutes:',
    '- `recommendedBidId`: the id of the single bid you would pick overall.',
    '- `confidence`: HIGH/MEDIUM/LOW - how confident you are in that recommendation given the data available (thin or missing scope/notes should lower confidence, not just close pricing).',
    '- `rationale`: 2-3 sentences on WHY that bid wins overall, citing actual numbers.',
    '- `priceSpread`: one short sentence quantifying the $ and % gap between the lowest and highest bid.',
    '- `risks`: 3-6 short bullet strings - the most important risks across the WHOLE set (not per-bid trivia) a reviewer must know before awarding.',
    '- `strengths`: 3-6 short bullet strings - the strongest positive differentiators seen across the set.',
    '- `scopeGaps`: 3-6 short bullet strings - specific missing items, unanswered fields, or ambiguous scope found in one or more bids (name which bid/company when relevant).',
    '- `followUpQuestions`: 3-6 short, concrete questions a buyer should ask bidders before awarding, based specifically on the gaps/risks you found - not generic procurement boilerplate.',
    'Every list should be empty (`[]`) rather than padded with filler if there is genuinely nothing notable to say.',
    'Each bid answers two tender forms, and each line item carries `tenderForm` and `tenderSection` so you can tell them apart. Project tender form sections: General acknowledgement, Bond information, Fees and markups, Labor rates, Certifications, Additional information, Disclaimers and clarifications. Package-specific tender form sections: Line items, Other cost questions, Alternates, Inclusions, Package-specific information and unit costs, Package-specific clarifications. Item `type` and `value` hold the answer or price: an INCLUSION valued NO/false is an exclusion, an unfilled item is a gap, and `unitCost` x `quantity` is an item price. Compare bids section by section, name the section when you cite a gap or risk, and say so if a section is absent from every bid rather than assuming it was answered. Items marked `Unclassified` could not be matched to a section.',
    'Several bids may come from the same company: treat the latest `submittedAt` as the current offer and the rest as earlier revisions, and say so instead of presenting them as competing bidders.',
    'Bids:',
    JSON.stringify(bids.map(summarizeBidForAnalysis), null, 2),
  ].filter(Boolean).join('\n\n');
}

// Strips each bid down to the fields relevant to a comparison, so the
// analysis prompt isn't padded with attachments/lineItem noise.
function summarizeBidForAnalysis(bid) {
  return {
    id: bid.id,
    bidderCompanyName: bid.bidderCompanyName || bid.bidderCompanyId,
    total: bid.total,
    leveledTotal: bid.leveledTotal,
    notes: stripHtml(bid.notes),
    submittedAt: bid.submittedAt,
    lineItems: compactLineItems(bid.lineItems),
  };
}

module.exports = {
  attachAiAnalysis,
  buildAnalysisPrompt,
  classifyLineItem,
  toItemArray,
  stripHtml,
};

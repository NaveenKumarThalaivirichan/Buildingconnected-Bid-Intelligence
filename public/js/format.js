// Shared formatting/derivation helpers used across every view.

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function truncateAtWord(text, maxLength) {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxLength * 0.6 ? lastSpace : maxLength)}…`;
}

// Renders BuildingConnected's simple rich-text fields (project/bid-package
// instructions) as plain text - never `innerHTML`'d, so this is just for
// display, not a sanitizer guarding against script execution.
export function stripHtml(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// "3 days ago" / "in 5 days" / "today" - used for the Projects view's
// lightweight activity indicator and bid-package due dates.
export function formatRelativeTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 1) return `in ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

export function daysUntil(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86_400_000);
}

export function formatNameId(name, id) {
  if (!id) return escapeHtml(name || '');
  if (!name || name === id) return escapeHtml(id);
  return `${escapeHtml(String(name))} <span class="id-tag">(${escapeHtml(id)})</span>`;
}

// Bidder identity for the Bids table: company name, revision, and id always
// shown explicitly - unlike formatNameId, this never collapses down to just
// the id when bidderCompanyName echoes back bidderCompanyId (BuildingConnected
// has no company-lookup in some cases), since that hides useful context.
export function formatBidIdentity(bid) {
  const companyLabel = escapeHtml(bid.bidderCompanyName || 'Unknown company');
  const idValue = bid.bidderCompanyId || bid.id;

  const subParts = [];
  if (typeof bid.revision === 'number') subParts.push(`Rev ${bid.revision}`);
  if (idValue) subParts.push(`ID: ${idValue}`);
  if (bid.submittedByName) subParts.push(`Submitted by ${bid.submittedByName}`);

  if (!subParts.length) return companyLabel;
  return `${companyLabel}<div class="cell-sub">${escapeHtml(subParts.join(' · '))}</div>`;
}

const STATE_LABELS = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' };

// Status badge for a project/bid-package's `state` field, shared by the
// Projects, Bid Packages, and Workspace views.
export function formatStatusBadge(rawState) {
  const key = (rawState || '').toUpperCase();
  const label = STATE_LABELS[key] || rawState || 'Unknown';
  const cls = key === 'PUBLISHED' ? 'badge-published' : key === 'ARCHIVED' ? 'badge-archived' : 'badge-draft';
  return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}

export function formatStars(rating) {
  if (typeof rating !== 'number' || rating < 1) return '—';
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
}

export function priceOf(bid) {
  return typeof bid.leveledTotal === 'number' ? bid.leveledTotal : bid.total;
}

// Compares each bid's leveledTotal (falling back to total) against the lowest
// and average within the bid package.
export function computeComparisons(bids) {
  const values = bids.map(priceOf).filter((v) => typeof v === 'number');
  const lowest = values.length ? Math.min(...values) : null;
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  return bids.map((bid) => {
    const val = priceOf(bid);
    if (typeof val !== 'number' || lowest === null) return { pctVsLowest: null, pctVsAverage: null };
    return {
      pctVsLowest: lowest === 0 ? null : ((val - lowest) / lowest) * 100,
      pctVsAverage: average === 0 ? null : ((val - average) / average) * 100,
    };
  });
}

export function lowestPercentClass(value) {
  if (value === null || value === undefined) return '';
  if (value <= 3) return 'stat-good';
  if (value <= 15) return 'stat-warning';
  return 'stat-critical';
}

export function averagePercentClass(value) {
  if (value === null || value === undefined) return '';
  if (value <= -5) return 'stat-good';
  if (value < 5) return '';
  if (value <= 15) return 'stat-warning';
  return 'stat-critical';
}

// lineItems arrives wrapped pagination-style ({ results: [...] }).
function toItemArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && Array.isArray(value.results)) return value.results;
  return [];
}

const SCOPE_TYPE_LABELS = {
  COST_BREAKDOWN: 'Cost items',
  INCLUSION: 'Inclusions',
  ALTERNATE: 'Alternates',
  ADDENDUM: 'Addenda',
};

// Derives a real scope summary + exceptions from the bid form's typed line
// items (COST_BREAKDOWN / INCLUSION / ALTERNATE / ADDENDUM / SCOPE_CLARIFICATION),
// confirmed against a live bid payload - not a guess at field names.
export function summarizeScope(bid) {
  const items = toItemArray(bid.lineItems);
  const byType = {};
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const type = item.type || 'OTHER';
    if (type === 'SCOPE_CLARIFICATION') continue;
    byType[type] = byType[type] || { total: 0, filled: 0 };
    byType[type].total += 1;
    if (item.value !== null && item.value !== undefined && item.value !== '') byType[type].filled += 1;
  }

  const clarification = items.find((i) => i?.type === 'SCOPE_CLARIFICATION' && i.value);
  const exclusions = items
    .filter((i) => i?.type === 'INCLUSION' && (i.value === 'NO' || i.value === false))
    .map((i) => i.description)
    .filter(Boolean);

  return {
    parts: Object.entries(byType).map(([type, { filled, total }]) => ({
      label: SCOPE_TYPE_LABELS[type] || type,
      filled,
      total,
    })),
    exceptionsText: clarification ? String(clarification.value) : null,
    exclusions,
  };
}

export function scopeSummaryText(bid) {
  const { parts } = summarizeScope(bid);
  if (!parts.length) return '—';
  return parts.map((p) => `${p.label} ${p.filled}/${p.total}`).join(' · ');
}

export function exceptionsText(bid) {
  const { exceptionsText: text, exclusions } = summarizeScope(bid);
  if (text) return text;
  if (exclusions.length) return `Excludes: ${exclusions.join(', ')}`;
  if (bid.notes) return String(bid.notes);
  return null;
}

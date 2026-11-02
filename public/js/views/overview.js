import { state, cache, setTab } from '../state.js';
import { fetchBidCount } from '../api.js';
import { escapeHtml, formatDate, formatCurrency, stripHtml } from '../format.js';

function fact(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<div class="fact"><div class="fact-label">${escapeHtml(label)}</div><div class="fact-value">${value}</div></div>`;
}

export async function renderOverview(content) {
  const bp = state.bidPackage;

  content.innerHTML = `
    <div class="overview-grid">
      <section class="panel">
        <h2 class="panel-title">Key facts</h2>
        <div class="fact-grid">
          ${fact('Bid Package ID', escapeHtml(bp.id))}
          ${fact('Bids Due', escapeHtml(formatDate(bp.bidsDueAt) || '—'))}
          ${fact('Job Walk', escapeHtml(formatDate(bp.jobWalkAt) || '—'))}
          ${fact('RFIs Due', escapeHtml(formatDate(bp.rfisDueAt) || '—'))}
          ${fact('Estimated Cost', bp.estimatedCost ? escapeHtml(formatCurrency(bp.estimatedCost)) : '')}
          ${fact('Bids received', '<span id="overview-bid-count" class="loading-inline">Loading…</span>')}
        </div>
        ${bp.keywords && bp.keywords.length ? `
          <div class="chip-row">
            ${bp.keywords.map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join('')}
          </div>
        ` : ''}
        ${bp.instructions ? `
          <h3 class="panel-subtitle">Instructions</h3>
          <p class="panel-text">${escapeHtml(stripHtml(bp.instructions))}</p>
        ` : ''}
      </section>

      ${bp.awardedBidId ? `
        <section class="panel panel-awarded">
          <h2 class="panel-title">Awarded</h2>
          <div class="fact-grid">
            ${fact('Company', escapeHtml(bp.awardedCompany?.name || '—'))}
            ${fact('Awarded amount', bp.awardedLeveledTotal ? escapeHtml(formatCurrency(bp.awardedLeveledTotal)) : '—')}
          </div>
        </section>
      ` : ''}

      <section class="panel panel-actions">
        <h2 class="panel-title">Next step</h2>
        <p class="panel-text">Compare submitted bids, or jump straight to the AI-generated recommendation.</p>
        <div class="action-row">
          <button type="button" class="btn btn-secondary" id="overview-view-bids">View Bids</button>
          <button type="button" class="btn btn-primary" id="overview-view-analysis">View AI Analysis</button>
        </div>
      </section>
    </div>
  `;

  document.getElementById('overview-view-bids').addEventListener('click', () => setTab('bids'));
  document.getElementById('overview-view-analysis').addEventListener('click', () => setTab('analysis'));

  const countEl = document.getElementById('overview-bid-count');
  let count = cache.bidCountByPackage.get(bp.id);
  if (count === undefined) {
    const { ok, data } = await fetchBidCount(bp.id);
    if (state.bidPackage !== bp) return;
    if (!ok) {
      countEl.textContent = '—';
      return;
    }
    count = data.count;
    cache.bidCountByPackage.set(bp.id, count);
  }
  if (state.bidPackage !== bp) return;
  countEl.className = '';
  countEl.textContent = String(count);
}

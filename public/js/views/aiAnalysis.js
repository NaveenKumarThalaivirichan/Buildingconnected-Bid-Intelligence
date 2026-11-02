import { state } from '../state.js';
import { loadBids } from './bids.js';
import {
  escapeHtml, formatCurrency, formatStars, formatNameId,
  computeComparisons, priceOf, formatPercent,
} from '../format.js';

function confidenceBadge(confidence) {
  const key = (confidence || 'LOW').toUpperCase();
  const cls = key === 'HIGH' ? 'badge-published' : key === 'MEDIUM' ? 'badge-draft' : 'badge-archived';
  return `<span class="badge ${cls}">${escapeHtml(key)} confidence</span>`;
}

function insightCard(title, icon, items, tone) {
  return `
    <section class="insight-card insight-${tone}">
      <h3 class="insight-title"><span class="insight-icon">${icon}</span>${escapeHtml(title)}</h3>
      ${items && items.length
        ? `<ul class="insight-list">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
        : '<p class="muted">Nothing notable flagged.</p>'}
    </section>
  `;
}

function priceBars(bids, recommendedId) {
  const values = bids.map((b) => ({ bid: b, price: priceOf(b) })).filter((v) => typeof v.price === 'number');
  if (!values.length) return '';
  const max = Math.max(...values.map((v) => v.price));

  return `
    <section class="panel">
      <h2 class="panel-title">Price comparison</h2>
      <div class="price-bars">
        ${values.map(({ bid, price }) => {
          const pct = max > 0 ? Math.max((price / max) * 100, 3) : 3;
          const isRecommended = bid.id === recommendedId;
          return `
            <div class="price-bar-row">
              <div class="price-bar-label">${formatNameId(bid.bidderCompanyName, bid.bidderCompanyId)}${isRecommended ? ' <span class="badge badge-published">Recommended</span>' : ''}</div>
              <div class="price-bar-track">
                <div class="price-bar-fill${isRecommended ? ' price-bar-recommended' : ''}" style="width:${pct}%"></div>
              </div>
              <div class="price-bar-value">${escapeHtml(formatCurrency(price))}</div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

export async function renderAiAnalysisTab(content) {
  const bp = state.bidPackage;
  content.innerHTML = '<div class="loading-inline">Fetching bids…</div>';
  const statusEl = content.firstElementChild;
  const analyzingTimer = setTimeout(() => {
    statusEl.textContent = 'Running AI analysis on each bid…';
  }, 1200);

  let entry;
  try {
    entry = await loadBids(bp);
  } catch (err) {
    clearTimeout(analyzingTimer);
    if (state.bidPackage !== bp) return;
    content.innerHTML = `<div class="error-inline">Error: ${escapeHtml(err.message)}</div>`;
    return;
  }
  clearTimeout(analyzingTimer);
  if (state.bidPackage !== bp) return;

  const { bids, summary } = entry;
  if (!bids.length) {
    content.innerHTML = '<div class="empty-state">No bids to analyze for this bid package.</div>';
    return;
  }

  const recommended = bids.find((b) => b.id === summary?.recommendedBidId)
    || bids.reduce((best, b) => ((b.aiRating || 0) > (best?.aiRating || 0) ? b : best), null);

  const comparisons = computeComparisons(bids);
  const recIndex = bids.indexOf(recommended);
  const recPct = recIndex >= 0 ? comparisons[recIndex].pctVsLowest : null;

  content.innerHTML = `
    <section class="hero-card">
      <div class="hero-top">
        <span class="hero-kicker">Recommended bidder</span>
        ${confidenceBadge(summary?.confidence)}
      </div>
      <h2 class="hero-name">${recommended ? formatNameId(recommended.bidderCompanyName, recommended.bidderCompanyId) : '—'}</h2>
      <div class="hero-meta">
        <span class="rating-cell hero-rating">${formatStars(recommended?.aiRating)}</span>
        ${recommended ? `<span>${escapeHtml(formatCurrency(priceOf(recommended)) || '—')}</span>` : ''}
        ${recPct !== null && recPct !== undefined ? `<span>${escapeHtml(formatPercent(recPct))} vs lowest</span>` : ''}
      </div>
      <p class="hero-rationale">${escapeHtml(summary?.rationale || 'No rationale available.')}</p>
      ${summary?.priceSpread ? `<p class="hero-spread">${escapeHtml(summary.priceSpread)}</p>` : ''}
    </section>

    ${priceBars(bids, recommended?.id)}

    <div class="insight-grid">
      ${insightCard('Risks', '⚠️', summary?.risks, 'critical')}
      ${insightCard('Strengths', '✓', summary?.strengths, 'good')}
      ${insightCard('Scope gaps & missing items', '🔍', summary?.scopeGaps, 'warning')}
      ${insightCard('Suggested follow-up questions', '💬', summary?.followUpQuestions, 'info')}
    </div>

    <section class="panel">
      <h2 class="panel-title">Per-bid analysis</h2>
      <div class="analysis-accordion" id="analysis-accordion"></div>
    </section>

    <p class="ai-disclaimer">Ratings and analysis are AI-generated from the bid data above — verify independently before making a decision.</p>
  `;

  const accordion = document.getElementById('analysis-accordion');
  const sorted = [...bids].sort((a, b) => (b.aiRating || 0) - (a.aiRating || 0));
  accordion.innerHTML = sorted.map((bid, i) => `
    <details class="analysis-item"${i === 0 ? ' open' : ''}>
      <summary>
        <span>${formatNameId(bid.bidderCompanyName, bid.bidderCompanyId)}</span>
        <span class="rating-cell">${formatStars(bid.aiRating)}</span>
      </summary>
      <p class="panel-text">${escapeHtml(bid.aiAnalysis || 'No analysis available.')}</p>
    </details>
  `).join('');
}

import { state, cache } from '../state.js';
import { fetchBids } from '../api.js';
import { openDrawer } from '../drawer.js';
import {
  escapeHtml, formatCurrency, formatPercent, formatDate, formatBidIdentity, formatStars,
  computeComparisons, priceOf, lowestPercentClass, averagePercentClass,
  scopeSummaryText, exceptionsText, truncateAtWord,
} from '../format.js';

// Shared by the Bids tab and the AI Analysis tab - fetches once (this is the
// expensive call that runs the AI comparison) and caches per bid package.
//
// Caches the in-flight PROMISE (not just the resolved value), so if both
// tabs call this while the analysis is still running, they share one
// request instead of each kicking off its own multi-minute AI analysis.
// Whichever tab is on screen when that shared promise resolves updates
// immediately - no need to switch tabs to "refresh".
export function loadBids(bidPackage) {
  let promise = cache.bidsByPackage.get(bidPackage.id);
  if (!promise) {
    promise = fetchBids(bidPackage.id).then(({ ok, data }) => {
      if (!ok) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      cache.analyzedPackageIds.add(bidPackage.id);
      return data; // { bids, summary }
    }).catch((err) => {
      cache.bidsByPackage.delete(bidPackage.id); // don't cache failures - allow retry
      throw err;
    });
    cache.bidsByPackage.set(bidPackage.id, promise);
  }
  return promise;
}

export async function renderBidsTab(content) {
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

  const { bids } = entry;
  if (!bids.length) {
    content.innerHTML = '<div class="empty-state">No bids found for this bid package.</div>';
    return;
  }

  content.innerHTML = `
    <div class="bids-toolbar">
      <input id="bids-search" class="search-input" type="search" placeholder="Filter by bidder…" />
      <select id="bids-sort" class="sort-select">
        <option value="price-asc">Price: Low to High</option>
        <option value="price-desc">Price: High to Low</option>
        <option value="rating-desc">Rating: High to Low</option>
      </select>
    </div>
    <div class="table-scroll">
      <table class="bids-table">
        <thead><tr>
          <th>Bidder</th><th>Status</th><th class="num">Amount</th>
          <th class="num">% vs Lowest</th><th class="num">% vs Average</th>
          <th>Submitted</th><th>Scope</th><th>Exceptions</th><th>Rating</th><th></th>
        </tr></thead>
        <tbody id="bids-tbody"></tbody>
      </table>
    </div>
    <p class="ai-disclaimer">Ratings and analysis are AI-generated from the bid data above — verify independently before making a decision.</p>
  `;

  const tbody = document.getElementById('bids-tbody');

  // Comparisons/best/priciest are computed once against the FULL set, so
  // filtering/sorting the visible rows never changes what "lowest" or "best"
  // means.
  const fullComparisons = computeComparisons(bids);
  const comparisonById = new Map(bids.map((b, i) => [b.id, fullComparisons[i]]));
  const bestRating = Math.max(...bids.map((b) => b.aiRating || 0));
  const priceValues = bids.map(priceOf).filter((v) => typeof v === 'number');
  const lowestPrice = priceValues.length ? Math.min(...priceValues) : null;
  const highestPrice = priceValues.length ? Math.max(...priceValues) : null;
  const priceVaries = lowestPrice !== null && highestPrice !== null && lowestPrice !== highestPrice;

  function draw(list) {
    tbody.innerHTML = '';
    list.forEach((bid) => {
      const tr = document.createElement('tr');
      tr.dataset.bidId = bid.id;
      const price = priceOf(bid);
      if (bestRating > 0 && bid.aiRating === bestRating) tr.classList.add('best-bid');
      if (priceVaries && price === highestPrice) tr.classList.add('priciest-bid');
      const { pctVsLowest, pctVsAverage } = comparisonById.get(bid.id) || {};
      const exceptions = exceptionsText(bid);
      tr.innerHTML = `
        <td>${formatBidIdentity(bid)}</td>
        <td><span class="badge ${bid.status === 'SUBMITTED' ? 'badge-published' : 'badge-draft'}">${escapeHtml(bid.status)}</span></td>
        <td class="num">${escapeHtml(formatCurrency(price) || '—')}</td>
        <td class="num ${lowestPercentClass(pctVsLowest)}">${escapeHtml(formatPercent(pctVsLowest))}</td>
        <td class="num ${averagePercentClass(pctVsAverage)}">${escapeHtml(formatPercent(pctVsAverage))}</td>
        <td>${escapeHtml(formatDate(bid.submittedAt) || '—')}</td>
        <td>${escapeHtml(scopeSummaryText(bid))}</td>
        <td class="exceptions-cell">${exceptions ? escapeHtml(truncateAtWord(exceptions, 60)) : '<span class="muted">None stated</span>'}</td>
        <td class="rating-cell">${formatStars(bid.aiRating)}</td>
        <td><button type="button" class="link-btn view-details-btn" data-bid-id="${escapeHtml(bid.id)}">Details</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  draw(bids);

  const searchInput = document.getElementById('bids-search');
  const sortSelect = document.getElementById('bids-sort');
  function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    let list = bids.filter((b) => (b.bidderCompanyName || b.bidderCompanyId || '').toLowerCase().includes(query));
    const sort = sortSelect.value;
    list = [...list].sort((a, b) => {
      if (sort === 'price-asc') return (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity);
      if (sort === 'price-desc') return (priceOf(b) ?? -Infinity) - (priceOf(a) ?? -Infinity);
      if (sort === 'rating-desc') return (b.aiRating || 0) - (a.aiRating || 0);
      return 0;
    });
    draw(list);
  }
  searchInput.addEventListener('input', applyFilters);
  sortSelect.addEventListener('change', applyFilters);

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-details-btn');
    if (!btn) return;
    const bid = bids.find((b) => b.id === btn.dataset.bidId);
    const row = tbody.querySelector(`tr[data-bid-id="${btn.dataset.bidId}"]`);
    if (bid) openDrawer(bid, row);
  });
}

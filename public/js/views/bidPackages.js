import { state, cache, goToWorkspace } from '../state.js';
import { fetchBidPackages, fetchBidCount } from '../api.js';
import { escapeHtml, formatDate, daysUntil, formatStatusBadge } from '../format.js';

const viewRoot = document.getElementById('view-root');

function dueBadge(bidsDueAt) {
  if (!bidsDueAt) return '<span class="muted">No due date</span>';
  const days = daysUntil(bidsDueAt);
  const label = formatDate(bidsDueAt);
  if (days === null) return escapeHtml(label);
  if (days < 0) return `<span class="due-text due-overdue">${escapeHtml(label)} · overdue</span>`;
  if (days <= 3) return `<span class="due-text due-soon">${escapeHtml(label)} · ${days === 0 ? 'due today' : `${days}d left`}</span>`;
  return `<span class="due-text">${escapeHtml(label)}</span>`;
}

export async function renderBidPackages() {
  const project = state.project;

  viewRoot.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">${escapeHtml(project.name || '(unnamed project)')}</h1>
        <p class="view-subtitle">Bid packages for this project.</p>
      </div>
    </div>
    <div id="bid-packages-list" class="loading-inline">Loading bid packages…</div>
  `;

  const container = document.getElementById('bid-packages-list');

  let bidPackages = cache.bidPackagesByProject.get(project.id);
  if (!bidPackages) {
    const { ok, data } = await fetchBidPackages(project.id);
    if (state.project !== project) return; // navigated away while loading
    if (!ok) {
      container.className = 'error-inline';
      container.textContent = 'Error: ' + (data.error || 'unknown error');
      return;
    }
    bidPackages = data;
    cache.bidPackagesByProject.set(project.id, bidPackages);
  }

  state.bidPackages = bidPackages;

  if (!bidPackages.length) {
    container.className = 'empty-state';
    container.textContent = 'No bid packages for this project.';
    return;
  }

  container.className = 'bp-list';
  container.innerHTML = bidPackages.map((bp) => `
    <article class="bp-row" data-id="${escapeHtml(bp.id)}">
      <div class="bp-row-main">
        <div class="bp-row-name">${escapeHtml(bp.name || '(unnamed bid package)')}${bp.number ? ` <span class="muted">· ${escapeHtml(bp.number)}</span>` : ''}</div>
        <div class="bp-row-id">${escapeHtml(bp.id)}</div>
      </div>
      <div class="bp-row-meta">
        ${formatStatusBadge(bp.state)}
        ${bp.awardedBidId ? '<span class="badge badge-awarded">Awarded</span>' : ''}
      </div>
      <div class="bp-row-due">${dueBadge(bp.bidsDueAt)}</div>
      <div class="bp-row-bids" data-bids-count><span class="loading-inline">Loading…</span></div>
      <div class="bp-row-ai">${cache.analyzedPackageIds.has(bp.id) ? '<span class="badge badge-analyzed">AI analyzed</span>' : '<span class="muted">Not analyzed yet</span>'}</div>
    </article>
  `).join('');

  container.querySelectorAll('.bp-row').forEach((row) => {
    row.addEventListener('click', () => {
      const bp = bidPackages.find((b) => b.id === row.dataset.id);
      if (bp) goToWorkspace(bp, 'overview');
    });
  });

  // Bid counts are cheap (no AI) but still one request each - fetch lazily
  // per row so the list itself renders instantly.
  bidPackages.forEach(async (bp) => {
    const cell = container.querySelector(`.bp-row[data-id="${bp.id}"] [data-bids-count]`);
    if (!cell) return;
    let count = cache.bidCountByPackage.get(bp.id);
    if (count === undefined) {
      const { ok, data } = await fetchBidCount(bp.id);
      if (!ok) {
        cell.textContent = '—';
        return;
      }
      count = data.count;
      cache.bidCountByPackage.set(bp.id, count);
    }
    if (state.project !== project) return;
    cell.textContent = `${count} bid${count === 1 ? '' : 's'}`;
  });
}

// The bid-details slide-over, shared by the Bids and AI Analysis tabs.
import { escapeHtml, formatCurrency, formatDateTime, formatNameId, formatStars, exceptionsText } from './format.js';

const drawer = document.getElementById('drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const drawerTitle = document.getElementById('drawer-title');
const drawerBody = document.getElementById('drawer-body');
const drawerClose = document.getElementById('drawer-close');

let selectedRow = null;

export function openDrawer(bid, row) {
  const nameLabel = bid.bidderCompanyName && bid.bidderCompanyName !== bid.bidderCompanyId
    ? `${bid.bidderCompanyName} (${bid.bidderCompanyId})`
    : (bid.bidderCompanyId || bid.id);
  drawerTitle.textContent = nameLabel;

  const exceptions = exceptionsText(bid);

  drawerBody.innerHTML = `
    <dl class="drawer-meta">
      <div><dt>AI Rating</dt><dd class="rating-cell">${formatStars(bid.aiRating)}</dd></div>
      <div><dt>Status</dt><dd>${escapeHtml(bid.status || '—')}</dd></div>
      <div><dt>Total</dt><dd>${formatCurrency(bid.total) || '—'}</dd></div>
      <div><dt>Leveled total</dt><dd>${formatCurrency(bid.leveledTotal) || '—'}</dd></div>
      <div><dt>Submitted by</dt><dd>${escapeHtml(bid.submittedByName || '—')}</dd></div>
      <div><dt>Revision</dt><dd>${typeof bid.revision === 'number' ? escapeHtml(String(bid.revision)) : '—'}</dd></div>
      <div><dt>Submitted</dt><dd>${formatDateTime(bid.submittedAt) || '—'}</dd></div>
      <div><dt>Bid package</dt><dd>${formatNameId(bid.bidPackageName, bid.bidPackageId)}</dd></div>
    </dl>
    <h4>AI analysis</h4>
    <p class="drawer-text">${escapeHtml(bid.aiAnalysis || 'No analysis available.')}</p>
    <h4>Exceptions / exclusions</h4>
    <p class="drawer-text">${exceptions ? escapeHtml(exceptions) : '<span class="muted">None stated</span>'}</p>
  `;

  if (selectedRow) selectedRow.classList.remove('selected-row');
  if (row) row.classList.add('selected-row');
  selectedRow = row || null;

  drawer.hidden = false;
  drawer.setAttribute('aria-hidden', 'false');
  drawerBackdrop.hidden = false;
}

export function closeDrawer() {
  drawer.hidden = true;
  drawer.setAttribute('aria-hidden', 'true');
  drawerBackdrop.hidden = true;
  if (selectedRow) {
    selectedRow.classList.remove('selected-row');
    selectedRow = null;
  }
}

drawerClose.addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
});

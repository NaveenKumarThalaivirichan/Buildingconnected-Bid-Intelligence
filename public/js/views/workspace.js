import { state, setTab } from '../state.js';
import { escapeHtml, formatDate, formatCurrency, formatStatusBadge } from '../format.js';
import { renderOverview } from './overview.js';
import { renderBidsTab } from './bids.js';
import { renderAiAnalysisTab } from './aiAnalysis.js';

const viewRoot = document.getElementById('view-root');

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'bids', label: 'Bids' },
  { id: 'analysis', label: 'AI Analysis' },
];

export function renderWorkspace() {
  const bp = state.bidPackage;

  viewRoot.innerHTML = `
    <div class="workspace-header">
      <div class="workspace-header-top">
        <h1 class="view-title">${escapeHtml(bp.name || '(unnamed bid package)')}</h1>
        ${formatStatusBadge(bp.state)}
      </div>
      <div class="workspace-facts">
        ${bp.number ? `<span>Package ${escapeHtml(bp.number)}</span>` : ''}
        <span>Due ${escapeHtml(formatDate(bp.bidsDueAt) || '—')}</span>
        ${bp.estimatedCost ? `<span>Est. ${escapeHtml(formatCurrency(bp.estimatedCost))}</span>` : ''}
        ${bp.awardedBidId ? '<span class="badge badge-awarded">Awarded</span>' : ''}
      </div>
    </div>
    <div class="tab-bar" role="tablist">
      ${TABS.map((t) => `<button type="button" class="tab-btn${state.tab === t.id ? ' active' : ''}" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="workspace-content"></div>
  `;

  viewRoot.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });

  const content = document.getElementById('workspace-content');
  if (state.tab === 'overview') renderOverview(content);
  else if (state.tab === 'bids') renderBidsTab(content);
  else renderAiAnalysisTab(content);
}

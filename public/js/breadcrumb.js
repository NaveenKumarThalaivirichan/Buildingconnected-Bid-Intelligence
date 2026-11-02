import { state, goToProjects, goToBidPackages } from './state.js';
import { escapeHtml } from './format.js';

const breadcrumbEl = document.getElementById('breadcrumb');

export function renderBreadcrumb() {
  const crumbs = [{ label: 'Projects', onClick: goToProjects }];

  if (state.project) {
    crumbs.push({ label: state.project.name || '(unnamed project)', onClick: () => goToBidPackages(state.project) });
  }
  if (state.view === 'workspace' && state.bidPackage) {
    crumbs.push({ label: state.bidPackage.name || '(unnamed bid package)', onClick: null });
  }

  breadcrumbEl.innerHTML = crumbs
    .map((c, i) => {
      const isLast = i === crumbs.length - 1;
      const sep = i > 0 ? '<span class="crumb-sep">/</span>' : '';
      const cls = isLast ? 'crumb crumb-current' : 'crumb';
      return `${sep}<span class="${cls}" data-idx="${i}">${escapeHtml(c.label)}</span>`;
    })
    .join('');

  crumbs.forEach((c, i) => {
    if (!c.onClick) return;
    const el = breadcrumbEl.querySelector(`[data-idx="${i}"]`);
    el.addEventListener('click', c.onClick);
  });
}

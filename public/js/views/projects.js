import { state, goToBidPackages } from '../state.js';
import { escapeHtml, formatRelativeTime, formatStatusBadge } from '../format.js';

const viewRoot = document.getElementById('view-root');

function isArchived(project) {
  return typeof project.state === 'string' && project.state.toUpperCase() === 'ARCHIVED';
}

function getProjectTooltip(project) {
  if (isArchived(project)) return 'Archived Project';
  return `Project ID: ${project.id}\nProject Name: ${project.name || '(unnamed project)'}`;
}

export function renderProjects() {
  viewRoot.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">Projects</h1>
        <p class="view-subtitle">Select a project to review its bid packages.</p>
      </div>
      <input id="project-search" class="search-input" type="search" placeholder="Search projects…" />
    </div>
    <div id="projects-grid" class="card-grid"></div>
  `;

  const grid = document.getElementById('projects-grid');
  const searchInput = document.getElementById('project-search');

  function renderGrid(filterText) {
    const filtered = filterText
      ? state.projects.filter((p) => (p.name || '').toLowerCase().includes(filterText.toLowerCase()))
      : state.projects;

    if (!filtered.length) {
      grid.innerHTML = `<div class="empty-state">No projects match "${escapeHtml(filterText)}".</div>`;
      return;
    }

    grid.innerHTML = filtered.map((p) => `
      <article class="project-card" data-id="${escapeHtml(p.id)}" title="${escapeHtml(getProjectTooltip(p))}">
        <div class="project-card-top">
          ${formatStatusBadge(p.state)}
        </div>
        <h3 class="project-card-name">${escapeHtml(p.name || '(unnamed project)')}</h3>
        <div class="project-card-id">${escapeHtml(p.id)}</div>
        <div class="project-card-footer">
          <span class="activity-dot"></span>
          <span>Updated ${escapeHtml(formatRelativeTime(p.updatedAt) || 'recently')}</span>
        </div>
      </article>
    `).join('');

    grid.querySelectorAll('.project-card').forEach((card) => {
      card.addEventListener('click', () => {
        const project = state.projects.find((p) => p.id === card.dataset.id);
        if (project) goToBidPackages(project);
      });
    });
  }

  renderGrid('');
  searchInput.addEventListener('input', () => renderGrid(searchInput.value.trim()));
}

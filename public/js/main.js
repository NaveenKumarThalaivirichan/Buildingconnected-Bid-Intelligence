import { state, cache, setRenderer, goToProjects } from './state.js';
import { fetchAuthStatus, fetchProjects, logout } from './api.js';
import { renderBreadcrumb } from './breadcrumb.js';
import { renderProjects } from './views/projects.js';
import { renderBidPackages } from './views/bidPackages.js';
import { renderWorkspace } from './views/workspace.js';

const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('error');
const appShell = document.getElementById('app-shell');
const loginScreen = document.getElementById('login-screen');

loginBtn.addEventListener('click', () => {
  window.location.href = '/api/oauth/login';
});

logoutBtn.addEventListener('click', async () => {
  await logout();

  state.projects = [];
  state.project = null;
  state.bidPackages = [];
  state.bidPackage = null;
  cache.bidPackagesByProject.clear();
  cache.bidsByPackage.clear();
  cache.bidCountByPackage.clear();
  cache.analyzedPackageIds.clear();

  errorEl.textContent = '';
  statusEl.textContent = '';
  appShell.hidden = true;
  loginScreen.hidden = false;
});

function render() {
  renderBreadcrumb();
  if (state.view === 'projects') renderProjects();
  else if (state.view === 'bidPackages') renderBidPackages();
  else renderWorkspace();
}
setRenderer(render);

async function loadProjects() {
  statusEl.textContent = 'Loading projects…';
  try {
    const { ok, data } = await fetchProjects();
    if (!ok) {
      errorEl.textContent = 'Error: ' + (data.error || 'unknown error');
      statusEl.textContent = '';
      return;
    }

    state.projects = data;
    statusEl.textContent = `${data.length} project${data.length === 1 ? '' : 's'}`;
    appShell.hidden = false;
    loginScreen.hidden = true;
    goToProjects();
  } catch (err) {
    errorEl.textContent = 'Network error: ' + err.message;
    statusEl.textContent = '';
  }
}

const params = new URLSearchParams(window.location.search);
if (params.get('authenticated') === '1') {
  loadProjects();
} else {
  fetchAuthStatus().then(({ authenticated }) => {
    if (authenticated) {
      loadProjects();
    } else {
      appShell.hidden = true;
      loginScreen.hidden = false;
    }
  });
}

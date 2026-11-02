// App-wide navigation state + caches, shared by every view module.
// Views never import each other directly - main.js wires a single render
// dispatcher via setRenderer(), which avoids circular view<->view imports.

export const state = {
  view: 'projects', // 'projects' | 'bidPackages' | 'workspace'
  projects: [],
  project: null,
  bidPackages: [],
  bidPackage: null,
  tab: 'overview', // 'overview' | 'bids' | 'analysis'
};

export const cache = {
  bidPackagesByProject: new Map(), // projectId -> bidPackages[]
  bidsByPackage: new Map(), // bidPackageId -> Promise<{ bids, summary }> (shared in-flight/resolved)
  bidCountByPackage: new Map(), // bidPackageId -> count
  analyzedPackageIds: new Set(), // bidPackageId - AI analysis has run this session
};

let renderFn = () => {};
export function setRenderer(fn) {
  renderFn = fn;
}

export function goToProjects() {
  state.view = 'projects';
  state.project = null;
  state.bidPackage = null;
  renderFn();
}

export function goToBidPackages(project) {
  state.view = 'bidPackages';
  state.project = project;
  state.bidPackage = null;
  renderFn();
}

export function goToWorkspace(bidPackage, tab = 'overview') {
  state.view = 'workspace';
  state.bidPackage = bidPackage;
  state.tab = tab;
  renderFn();
}

export function setTab(tab) {
  state.tab = tab;
  renderFn();
}

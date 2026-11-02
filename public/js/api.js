// Every network call the frontend makes, in one place.

export async function fetchAuthStatus() {
  const res = await fetch('/api/auth/status');
  return res.json();
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export async function fetchProjects() {
  const res = await fetch('/api/projects');
  const data = await res.json();
  return { ok: res.ok, data };
}

export async function fetchBidPackages(projectId) {
  const res = await fetch(`/api/projects/${projectId}/bid-packages`);
  const data = await res.json();
  return { ok: res.ok, data };
}

// Cheap: bid count only, no name enrichment, no AI analysis - safe to call
// once per bid package when rendering the Bid Packages list.
export async function fetchBidCount(bidPackageId) {
  const res = await fetch(`/api/bid-packages/${bidPackageId}/bids/count`);
  const data = await res.json();
  return { ok: res.ok, data };
}

// Expensive: runs the full AI comparison. Only call when the user actually
// opens a bid package's Bids/AI Analysis tab.
export async function fetchBids(bidPackageId) {
  const res = await fetch(`/api/bid-packages/${bidPackageId}/bids`);
  const data = await res.json();
  return { ok: res.ok, data };
}

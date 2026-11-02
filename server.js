require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { attachAiAnalysis } = require('./aiAnalysis');

const {
  APS_CLIENT_ID,
  APS_CLIENT_SECRET,
  APS_CALLBACK_URL,
  APS_SCOPES = 'data:read',
  PORT = 3737,
  // Loopback by default: the API has no login of its own, so it must not be
  // reachable from other machines on the network.
  HOST = '127.0.0.1',
} = process.env;

if (!APS_CLIENT_ID || !APS_CLIENT_SECRET || !APS_CALLBACK_URL) {
  console.error('Missing APS_CLIENT_ID / APS_CLIENT_SECRET / APS_CALLBACK_URL. Copy .env.example to .env and fill in your APS app credentials.');
  process.exit(1);
}

const AUTHORIZE_URL = 'https://developer.api.autodesk.com/authentication/v2/authorize';
const TOKEN_URL = 'https://developer.api.autodesk.com/authentication/v2/token';
const BC_V2_BASE = 'https://developer.api.autodesk.com/construction/buildingconnected/v2';
const CURRENT_USER_URL = `${BC_V2_BASE}/users/me`;
const PROJECTS_URL = 'https://developer.api.autodesk.com/construction/buildingconnected/v3/projects';
const PROJECTS_V2_URL = `${BC_V2_BASE}/projects`;
const BID_PACKAGES_URL = `${BC_V2_BASE}/bid-packages`;
const BIDS_URL = `${BC_V2_BASE}/bids`;
const COMPANIES_URL = `${BC_V2_BASE}/companies`;
const OFFICES_URL = `${BC_V2_BASE}/offices`;
const USERS_URL = `${BC_V2_BASE}/users`;

process.on('uncaughtException', (err) => { console.error(err); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error(err); });

// Single-user local dev tool: keep the token and CSRF state in memory rather than a session store.
let tokenStore = null; // { accessToken, refreshToken, expiresAt }
let pendingState = null;

const app = express();
app.use(express.static('public'));

app.get('/api/oauth/login', (req, res) => {
  pendingState = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: APS_CLIENT_ID,
    redirect_uri: APS_CALLBACK_URL,
    scope: APS_SCOPES,
    state: pendingState,
  });
  res.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
});

app.get('/api/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Authorization failed: ${error} - ${error_description || ''}`);
  }
  if (!state || state !== pendingState) {
    return res.status(400).send('Invalid or missing OAuth state.');
  }
  pendingState = null;

  try {
    const basicAuth = Buffer.from(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: APS_CALLBACK_URL,
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body,
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error('Token exchange failed:', tokenJson);
      return res.status(502).send('Failed to exchange authorization code for a token. Check the server console.');
    }

    tokenStore = {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      expiresAt: Date.now() + tokenJson.expires_in * 1000,
    };

    res.redirect('/?authenticated=1');
  } catch (err) {
    console.error(err);
    res.status(500).send('Unexpected error during OAuth callback.');
  }
});

async function refreshAccessToken() {
  const basicAuth = Buffer.from(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokenStore.refreshToken,
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body,
  });

  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) {
    throw new Error(`Refresh failed: ${JSON.stringify(tokenJson)}`);
  }

  tokenStore = {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token || tokenStore.refreshToken,
    expiresAt: Date.now() + tokenJson.expires_in * 1000,
  };
}

async function getValidAccessToken() {
  if (!tokenStore) return null;
  // Refresh a little early to avoid a request landing right at expiry.
  if (Date.now() > tokenStore.expiresAt - 60_000) {
    await refreshAccessToken();
  }
  return tokenStore.accessToken;
}

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: !!tokenStore });
});

app.post('/api/auth/logout', (req, res) => {
  tokenStore = null;
  res.json({ ok: true });
});

// Follows pagination (next-page link/cursor) and collects every item across all pages.
async function fetchAllPages(url, accessToken) {
  const items = [];

  while (url) {
    const apiRes = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await apiRes.json();

    if (!apiRes.ok) {
      const err = new Error('BuildingConnected API request failed.');
      err.status = apiRes.status;
      err.details = data;
      throw err;
    }

    const page = Array.isArray(data) ? data : data.results || data.items || data.data || [];
    items.push(...page);

    url = data.pagination?.nextUrl || data.next || data.nextPage || null;
  }

  return items;
}

// Best-effort GET that never throws - returns null on any error (404, network,
// auth, etc.) so an optional lookup degrades to "fall back to the raw ID"
// instead of breaking the caller.
async function tryGetJson(url, accessToken) {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// The reference "Get bids from Bid packages" flow, ported from Test/src/services/buildingConnected/bids.js.
async function fetchBidsForPackage(accessToken, bidPackageId) {
  const url = `${BIDS_URL}?${new URLSearchParams({ 'filter[bidPackageId]': bidPackageId, limit: '100' })}`;
  const bids = await fetchAllPages(url, accessToken);

  bids.forEach((bid) => {
    // BuildingConnected doesn't expose an explicit bid status field - submittedAt
    // is the signal the API itself uses to distinguish a submitted bid from a draft.
    bid.status = bid.submittedAt ? 'SUBMITTED' : 'DRAFT';
  });

  return bids;
}

// Adds projectName / bidPackageName / bidderCompanyName to every bid, falling
// back to the raw ID for whichever lookups don't resolve.
async function enrichBidsWithNames(accessToken, bids) {
  if (bids.length === 0) return;

  const bidPackageId = bids[0].bidPackageId;
  let bidPackage = null;
  if (bidPackageId) {
    bidPackage = await tryGetJson(`${BID_PACKAGES_URL}/${encodeURIComponent(bidPackageId)}`, accessToken);
  }
  const bidPackageName = bidPackage?.name || bidPackageId;

  const projectId = bidPackage?.projectId || bids[0].projectId;
  let projectName = projectId;
  if (projectId) {
    const project = await tryGetJson(`${PROJECTS_V2_URL}/${encodeURIComponent(projectId)}`, accessToken);
    projectName = project?.name || projectId;
  }

  // bidderCompanyId is actually a BuildingConnected office id - GET /companies/:id
  // 404s for it, which is why bidderCompanyName used to just echo the id back.
  // GET /offices/:id resolves it; fall back to /companies for the rare id that
  // isn't an office.
  const companyNameById = new Map();
  const companyIds = [...new Set(bids.map((b) => b.bidderCompanyId).filter(Boolean))];
  for (const companyId of companyIds) {
    const office = await tryGetJson(`${OFFICES_URL}/${encodeURIComponent(companyId)}`, accessToken);
    let name = office?.name;
    if (!name) {
      const company = await tryGetJson(`${COMPANIES_URL}/${encodeURIComponent(companyId)}`, accessToken);
      name = company?.name;
    }
    companyNameById.set(companyId, name || companyId);
  }

  const userNameById = new Map();
  const userIds = [...new Set(bids.map((b) => b.submittedBy).filter(Boolean))];
  for (const userId of userIds) {
    const user = await tryGetJson(`${USERS_URL}/${encodeURIComponent(userId)}`, accessToken);
    const name = user && ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || user.email);
    userNameById.set(userId, name || userId);
  }

  bids.forEach((b) => {
    b.projectName = projectName;
    b.bidPackageName = bidPackageName;
    b.bidderCompanyName = companyNameById.get(b.bidderCompanyId) || b.bidderCompanyId || null;
    b.submittedByName = b.submittedBy ? userNameById.get(b.submittedBy) || b.submittedBy : null;
  });
}

// Wraps an async route handler: resolves the access token (401 if the user
// hasn't signed in) and funnels every failure through one error responder.
function authedRoute(handler) {
  return async (req, res) => {
    try {
      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        return res.status(401).json({ error: 'Not authenticated. Visit /api/oauth/login first.' });
      }
      await handler(req, res, accessToken);
    } catch (err) {
      if (err.status) {
        console.error('BuildingConnected API error:', err.details);
        return res.status(err.status).json({ error: err.message, details: err.details });
      }
      console.error(err);
      res.status(500).json({ error: 'Unexpected server error.' });
    }
  };
}

app.get('/api/projects', authedRoute(async (req, res, accessToken) => {
  const meRes = await fetch(CURRENT_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = await meRes.json();
  if (!meRes.ok) {
    console.error('BuildingConnected API error:', me);
    return res.status(meRes.status).json({ error: 'Failed to fetch current user.', details: me });
  }

  const url = `${PROJECTS_URL}?${new URLSearchParams({ 'filter[userId]': me.id })}`;
  res.json(await fetchAllPages(url, accessToken));
}));

app.get('/api/projects/:projectId/bid-packages', authedRoute(async (req, res, accessToken) => {
  const url = `${BID_PACKAGES_URL}?${new URLSearchParams({ 'filter[projectId]': req.params.projectId })}`;
  res.json(await fetchAllPages(url, accessToken));
}));

// "Get bids from Bid packages" + AI analysis, ported from Test/src/routes/bids.js.
app.get('/api/bid-packages/:bidPackageId/bids', authedRoute(async (req, res, accessToken) => {
  const bids = await fetchBidsForPackage(accessToken, req.params.bidPackageId);
  await enrichBidsWithNames(accessToken, bids);
  const summary = await attachAiAnalysis(bids);
  res.json({ bids, summary });
}));

// Bid count only - no name enrichment, no AI - so the Bid Packages list can
// show "bids received" per package without paying the AI-analysis cost N times.
app.get('/api/bid-packages/:bidPackageId/bids/count', authedRoute(async (req, res, accessToken) => {
  const bids = await fetchBidsForPackage(accessToken, req.params.bidPackageId);
  res.json({ count: bids.length });
}));

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
});

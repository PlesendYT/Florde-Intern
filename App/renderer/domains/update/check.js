// Update-Check: vergleicht die lokale App-Version mit
// https://florde.vercel.app/version.json (Format: {"version":"1.0"}).
// Still ohne Netz / bei Fehlern: kein Badge, kein Error.
const UPDATE_VERSION_URL = 'https://florde.vercel.app/version.json';
const UPDATE_DOWNLOAD_URL = 'https://florde.vercel.app/downloads';

function normalizeVersion(v) {
  if (typeof v !== 'string') return null;
  let t = v.trim().replace(/^[vV]/, '');
  if (!t) return null;
  const parts = t.split('.');
  const nums = [];
  for (const p of parts) {
    if (!/^\d+/.test(p)) return null;
    nums.push(parseInt(p, 10));
  }
  return nums;
}

function isNewer(remote, local) {
  const r = normalizeVersion(remote);
  const l = normalizeVersion(local);
  if (!r || !l) return false;
  const n = Math.max(r.length, l.length);
  for (let i = 0; i < n; i++) {
    const a = r[i] || 0;
    const b = l[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

function parseVersionPayload(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const data = JSON.parse(text);
    const v = data && data.version;
    if (typeof v !== 'string' || !v.trim()) return null;
    return v.trim();
  } catch {
    return null;
  }
}

async function checkForUpdate({ url, localVersion, fetchFn, isOnline, timeoutMs }) {
  const online = typeof isOnline === 'function'
    ? isOnline()
    : (typeof navigator !== 'undefined' ? navigator.onLine : true);
  if (online === false) return { update: false, remote: null };
  try {
    const fetchImpl = fetchFn || fetch;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 10000) : null;
    let res;
    try {
      const opts = ctrl ? { signal: ctrl.signal } : undefined;
      res = await fetchImpl(url || UPDATE_VERSION_URL, opts);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res || res.ok === false) return { update: false, remote: null };
    const remote = parseVersionPayload(await res.text());
    if (!remote) return { update: false, remote: null };
    return { update: isNewer(remote, localVersion), remote };
  } catch {
    return { update: false, remote: null };
  }
}

export { UPDATE_VERSION_URL, UPDATE_DOWNLOAD_URL, normalizeVersion, isNewer, parseVersionPayload, checkForUpdate };
export default { UPDATE_VERSION_URL, UPDATE_DOWNLOAD_URL, normalizeVersion, isNewer, parseVersionPayload, checkForUpdate };
if (typeof window !== 'undefined') window.__updateCheck = { UPDATE_VERSION_URL, UPDATE_DOWNLOAD_URL, normalizeVersion, isNewer, parseVersionPayload, checkForUpdate };

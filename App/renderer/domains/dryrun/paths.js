function normalizePosix(p) {
  const absolute = p.startsWith('/');
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return (absolute ? '/' : '') + parts.join('/');
}

function toPosixRoot(root) {
  let r = String(root || '').replace(/\\/g, '/');
  const drive = r.match(/^([A-Za-z]):\//);
  if (drive) r = '/' + drive[1].toLowerCase() + r.slice(3);
  if (!r.startsWith('/')) r = '/' + r;
  return r.replace(/\/+$/, '') || '/';
}

function resolveInRoot(root, userPath) {
  if (typeof userPath !== 'string' || userPath.trim() === '') return null;
  const base = toPosixRoot(root);
  const rel = String(userPath).replace(/\\/g, '/').trim();
  if (/^[A-Za-z]:\//.test(rel) || rel.startsWith('/')) return null;
  const resolved = normalizePosix(base + '/' + rel);
  if (resolved !== base && !resolved.startsWith(base + '/')) return null;
  return resolved;
}

export { resolveInRoot, normalizePosix };
export default { resolveInRoot, normalizePosix };
if (typeof window !== 'undefined') window.__dryrunPaths = { resolveInRoot, normalizePosix };

export function parsePluginManifest(raw, base = {}) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, data: base };
  }
  return { ok: true, data: Object.assign({}, base, parsed) };
}

export function ensurePluginId(manifest, now = () => Date.now()) {
  if (manifest.id) return manifest;
  return Object.assign({}, manifest, { id: 'local-' + now() });
}

export function localPluginDefaults(idNow = () => Date.now()) {
  return {
    id: 'local-' + idNow(),
    name: 'Local Plugin',
    version: '1.0.0',
    description: 'Local development plugin',
    author: 'Developer',
    installed: true,
    enabled: true,
    builtin: false,
    local: true,
  };
}

if (typeof window !== 'undefined') {
  window.__marketplaceManifest = { parsePluginManifest, ensurePluginId, localPluginDefaults };
}
export default { parsePluginManifest, ensurePluginId, localPluginDefaults };

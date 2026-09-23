// Secret input protection: every input carrying data-secret="true"
// (API keys, tokens, route keys) is forced into masked, non-memorized
// password mode. Call once at startup and after dynamic renders; the
// MutationObserver closes the gap for inputs added later.
export function applySecretProtection(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return 0;
  let count = 0;
  scope.querySelectorAll('[data-secret]').forEach((el) => {
    if (!el || el.tagName !== 'INPUT') return;
    if (el.type !== 'password') el.type = 'password';
    if (el.getAttribute && el.getAttribute('autocomplete') !== 'new-password') {
      el.setAttribute('autocomplete', 'new-password');
    }
    el.spellcheck = false;
    el.autocapitalize = 'off';
    count++;
  });
  return count;
}

export function observeSecretProtection(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof MutationObserver === 'undefined') return null;
  const target = scope === document ? document.documentElement : scope;
  if (!target) return null;
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes || []) {
        if (node && node.nodeType === 1) applySecretProtection(node);
      }
    }
  });
  observer.observe(target, { childList: true, subtree: true });
  return observer;
}

export default { applySecretProtection, observeSecretProtection };
if (typeof window !== 'undefined') window.__secrets = { applySecretProtection, observeSecretProtection };

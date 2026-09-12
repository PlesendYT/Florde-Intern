window.PermissionDialog = {
  _active: null,
  init() {
    if (typeof window.onPermissionRequest === 'function') {
      window.onPermissionRequest((info) => this._show(info));
    }
  },
  _show(info) {
    const esc = (s) => (s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    if (!info || (!info.command && !info.path && !info.op)) return;
    if (this._active) this._active.remove();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--surface-raised);color:var(--text-primary);border:1px solid var(--border-subtle);border-radius:8px;padding:1.2rem 1.5rem;max-width:520px;width:92%;';
    const riskColor = { critical: 'var(--status-danger)', high: 'var(--status-warn)', medium: 'var(--status-warn)', low: 'var(--status-success)', safe: 'var(--status-success)' }[info.risk] || 'var(--text-primary)';
    card.innerHTML = `
      <h3 style="margin:0 0 .6rem;">Genehmigung erforderlich</h3>
      <div style="font-size:.8rem;color:var(--text-secondary);margin-bottom:.6rem;">Backend: <b>${esc(info.backend) || '-'}</b> &middot; Kategorie: <b>${esc(info.category || info.op) || '-'}</b></div>
      <div style="font-size:.8rem;margin-bottom:.6rem;color:${riskColor};font-weight:600;">Risiko: ${esc(info.risk) || 'safe'}</div>
      <div class="perm-risk-grid"><span>Risiko:</span><span>${esc(info.risk) || '—'}</span><span>Sandbox:</span><span>${esc(info.sandbox) || '—'}</span><span>Network:</span><span>${esc(info.network) || '—'}</span></div>
      <pre style="background:var(--surface-background);color:var(--text-primary);padding:.6rem;border:1px solid var(--border-subtle);border-radius:4px;overflow:auto;white-space:pre-wrap;font-family:monospace;font-size:.85rem;">${esc(info.command || info.path)}</pre>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem;">
        <button data-d="allow" data-p="once" class="btn btn-primary" style="flex:1;">Einmal erlauben</button>
        <button data-d="allow" data-p="always" class="btn btn-secondary" style="flex:1;">Immer erlauben</button>
        <button data-d="block" data-p="once" class="btn" style="flex:1;">Einmal blocken</button>
        <button data-d="block" data-p="always" class="btn danger" style="flex:1;">Immer blocken</button>
      </div>
    `;
    overlay.appendChild(card);
    const cleanup = () => { this._active = null; overlay.remove(); };
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-d]');
      if (!btn) return;
      const decision = btn.dataset.d, persist = btn.dataset.p;
      cleanup();
      window.respondPermission({ requestId: info.requestId, decision, persist });
    });
    document.body.appendChild(overlay);
    this._active = overlay;
  },
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.PermissionDialog.init());
else window.PermissionDialog.init();

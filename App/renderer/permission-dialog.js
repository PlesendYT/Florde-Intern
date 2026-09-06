window.PermissionDialog = {
  _active: null,
  init() {
    if (typeof window.onPermissionRequest === 'function') {
      window.onPermissionRequest((info) => this._show(info));
    }
  },
  _show(info) {
    if (!info || (!info.command && !info.path && !info.op)) return;
    if (this._active) this._active.remove();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
    const card = document.createElement('div');
    card.style.cssText = 'background:#1e1e1e;color:#ddd;border:1px solid #444;border-radius:8px;padding:1.2rem 1.5rem;max-width:520px;width:92%;box-shadow:0 8px 30px rgba(0,0,0,.5);';
    const riskColor = { critical: '#e53935', high: '#fb8c00', medium: '#fdd835', low: '#66bb6a', safe: '#81c784' }[info.risk] || '#fff';
    card.innerHTML = `
      <h3 style="margin:0 0 .6rem;">Genehmigung erforderlich</h3>
      <div style="font-size:.8rem;color:#aaa;margin-bottom:.6rem;">Backend: <b>${info.backend || '-'}</b> &middot; Kategorie: <b>${info.category || info.op || '-'}</b></div>
      <div style="font-size:.8rem;margin-bottom:.6rem;color:${riskColor};font-weight:600;">Risiko: ${info.risk || 'safe'}</div>
      <pre style="background:#111;padding:.6rem;border-radius:4px;overflow:auto;white-space:pre-wrap;font-family:monospace;font-size:.85rem;">${(info.command || info.path || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</pre>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:1rem;">
        <button data-d="allow" data-p="once" style="flex:1;background:#2e7d32;color:#fff;border:0;border-radius:4px;padding:.5rem;">Einmal erlauben</button>
        <button data-d="allow" data-p="always" style="flex:1;background:#1b5e20;color:#fff;border:0;border-radius:4px;padding:.5rem;">Immer erlauben</button>
        <button data-d="block" data-p="once" style="flex:1;background:#37474f;color:#fff;border:0;border-radius:4px;padding:.5rem;">Einmal blocken</button>
        <button data-d="block" data-p="always" style="flex:1;background:#b71c1c;color:#fff;border:0;border-radius:4px;padding:.5rem;">Immer blocken</button>
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

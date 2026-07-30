// App/renderer/sandbox-settings.js

const SandboxSettings = {
  _container: null,

  async init() {
    const status = await window.electronAPI.sandbox.status();
    this._render(status);
  },

  _render(status) {
    const html = `
      <div class="settings-section">
        <h3>Sandbox</h3>
        <p style="color:var(--text2);font-size:0.85rem;margin-bottom:1rem;">
          Wähle aus, wie die KI Befehle ausführen soll.
        </p>

        <div style="margin-bottom:1rem;">
          <label style="display:block;margin-bottom:0.3rem;font-weight:600;">Sandbox-Typ</label>
          <select id="sandbox-type-select" style="width:100%;padding:0.4rem;border-radius:4px;">
            <option value="none" ${status.active === 'none' ? 'selected' : ''}>Keine Sandbox (aktuell)</option>
            <option value="firejail" ${status.active === 'firejail' ? 'selected' : ''}>Firejail</option>
            <option value="docker" ${status.active === 'docker' ? 'selected' : ''}>Docker</option>
            <option value="podman" ${status.active === 'podman' ? 'selected' : ''}>Podman</option>
          </select>
          <div style="margin-top:0.5rem;font-size:0.8rem;color:var(--text3);">
            Aktuell: <strong>${status.active}</strong>
          </div>
        </div>

        <button id="btn-sandbox-detect" class="btn btn-small">System erkennen & Empfehlung</button>
        <div id="sandbox-recommendation" style="margin-top:0.5rem;font-size:0.85rem;"></div>
      </div>
    `;

    this._container = document.getElementById('sandbox-settings-content');
    if (this._container) this._container.innerHTML = html;

    document.getElementById('sandbox-type-select')?.addEventListener('change', async (e) => {
      const type = e.target.value;
      try {
        await window.electronAPI.sandbox.switchBackend(type);
        showNotification('success', `Sandbox auf ${type} umgestellt`);
      } catch (err) {
        showNotification('error', 'Fehler: ' + err.message);
      }
    });

    document.getElementById('btn-sandbox-detect')?.addEventListener('click', async () => {
      try {
        const spec = await window.electronAPI.sandbox.detect();
        const recs = await window.electronAPI.sandbox.recommend(spec);
        const div = document.getElementById('sandbox-recommendation');
        div.innerHTML = '<strong>System:</strong><br>' +
          `CPU: ${spec.cpu.model} (${spec.cpu.cores} Cores)<br>` +
          `RAM: ${spec.ram.total} MB<br>` +
          `GPU: ${spec.gpu.model}${spec.gpu.vram > 0 ? ' (' + spec.gpu.vram + ' MB VRAM)' : ''}<br>` +
          `<br><strong>Empfehlung:</strong><br>` +
          recs.map(r => `• ${r.type}: ${r.reason}`).join('<br>');
      } catch (err) {
        showNotification('error', 'Fehler: ' + err.message);
      }
    });
  }
};

// Load when settings tab is opened
document.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(() => {
    if (document.getElementById('sandbox-settings-content')) {
      SandboxSettings.init();
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById('settings-modal') || document.body, { childList: true, subtree: true });
});

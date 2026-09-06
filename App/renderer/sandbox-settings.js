// App/renderer/sandbox-settings.js

const SandboxSettings = {
  _container: null,

  async init() {
    const status = await window.electronAPI.sandbox.status();
    this._render(status);
    await this._renderVmConfig();
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
            <option value="vmware" ${status.active === 'vmware' ? 'selected' : ''}>VMware</option>
            <option value="qemu" ${status.active === 'qemu' ? 'selected' : ''}>QEMU/KVM</option>
          </select>
          <div style="margin-top:0.5rem;font-size:0.8rem;color:var(--text3);">
            Aktuell: <strong>${status.active}</strong>
          </div>
        </div>

        <button id="btn-sandbox-detect" class="btn btn-small">System erkennen & Empfehlung</button>
        <div id="sandbox-recommendation" style="margin-top:0.5rem;font-size:0.85rem;"></div>
        <button id="btn-sandbox-wizard" class="btn btn-small" style="margin-top:0.5rem;">Setup erneut starten</button>
        <div id="sandbox-vm-config" style="margin-top:0.75rem;"></div>
        <div id="sandbox-custom-tools" style="margin-top:1rem;"></div>
      </div>
    `;

    this._container = document.getElementById('sandbox-settings-content');
    if (this._container) this._container.innerHTML = html;

    document.getElementById('sandbox-type-select')?.addEventListener('change', async (e) => {
      const type = e.target.value;
      try {
        const r = await window.electronAPI.sandbox.switchBackend(type);
        if (r && r.ok === false) {
          showNotification('error', 'Umschaltung auf ' + type + ' fehlgeschlagen: ' + (r.error || 'unbekannter Fehler'));
          await SandboxSettings.init();
          return;
        }
        await window.electronAPI.sandbox.setConfig({ type });
        const isVm = e.target.value === 'vmware' || e.target.value === 'qemu';
        if (isVm) { if (typeof SandboxVmPanel !== 'undefined') SandboxVmPanel.show(); }
        else { if (typeof SandboxVmPanel !== 'undefined') SandboxVmPanel.hide(); }
        showNotification('success', `Sandbox auf ${type} umgestellt`);
        if (typeof this._renderVmConfig === 'function') this._renderVmConfig();
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

    document.getElementById('btn-sandbox-wizard')?.addEventListener('click', () => {
      if (typeof SandboxWizard !== 'undefined') SandboxWizard.open();
    });

    this._renderCustomTools(status);
  },

  async _renderCustomTools(status) {
    const box = document.getElementById('sandbox-custom-tools');
    if (!box) return;
    const isContainer = status.active === 'docker' || status.active === 'podman';
    if (!isContainer) { box.innerHTML = ''; return; }
    const project = (typeof currentProject !== 'undefined' && currentProject) ? currentProject : null;
    if (!project) {
      box.innerHTML = '<div style="font-size:0.85rem;color:var(--text3);">Öffne ein Projekt, um Custom-Tools pro Projekt zu konfigurieren.</div>';
      return;
    }
    const tools = (await window.electronAPI.sandbox.getCustomTools?.(project)) || [];
    const typeOpts = ['apt', 'deb', 'appimage'].map(t => `<option value="${t}">${t}</option>`).join('');
    const rows = tools.map((tool, i) => `
      <div style="display:flex;gap:0.4rem;align-items:center;margin-bottom:0.4rem;" data-tool-row="${i}">
        <select class="ct-type" style="flex:1;padding:0.3rem;">${typeOpts.replace(`<option value="${tool.type}">`, `<option value="${tool.type}" selected>`) || typeOpts}</select>
        <input class="ct-name" type="text" value="${(tool.name || '').replace(/"/g, '&quot;')}" placeholder="Tool-Name" style="flex:2;padding:0.3rem;" />
        <label style="font-size:0.8rem;"><input class="ct-global" type="checkbox" ${tool.global ? 'checked' : ''} /> global</label>
        <button class="btn btn-small ct-remove">×</button>
      </div>`).join('');
    box.innerHTML = `
      <div style="font-weight:600;margin-bottom:0.4rem;">Custom Tools (pro Projekt)</div>
      ${rows || '<div style="font-size:0.85rem;color:var(--text3);">Keine Custom-Tools konfiguriert.</div>'}
      <button id="btn-ct-add" class="btn btn-small" style="margin-top:0.4rem;">Tool hinzufügen</button>`;

    const collect = () => Array.from(box.querySelectorAll('[data-tool-row]')).map(row => ({
      type: row.querySelector('.ct-type').value,
      name: row.querySelector('.ct-name').value.trim(),
      global: row.querySelector('.ct-global').checked,
    }));

    const save = async () => {
      const curProject = (typeof currentProject !== 'undefined' && currentProject) ? currentProject : null;
      if (!curProject) return;
      await window.electronAPI.sandbox.setCustomTools(curProject, collect().filter(t => t.name));
    };

    box.querySelector('#btn-ct-add')?.addEventListener('click', async () => {
      tools.push({ type: 'apt', name: '', global: false });
      await this._renderCustomTools(status);
      const nameInput = box.querySelector('[data-tool-row]:last-of-type .ct-name');
      if (nameInput) {
        nameInput.focus();
        nameInput.addEventListener('change', save);
      }
    });
    box.querySelectorAll('.ct-remove').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const row = e.target.closest('[data-tool-row]');
        const idx = parseInt(row.dataset.toolRow, 10);
        tools.splice(idx, 1);
        await this._renderCustomTools(status);
      });
    });
    box.querySelectorAll('.ct-name').forEach((input) => {
      input.addEventListener('change', save);
    });
    box.querySelectorAll('.ct-type').forEach((sel) => {
      sel.addEventListener('change', save);
    });
    box.querySelectorAll('.ct-global').forEach((cb) => {
      cb.addEventListener('change', save);
    });
  },

  async _renderVmConfig() {
    const box = document.getElementById('sandbox-vm-config');
    if (!box) return;
    const cfg = (await window.electronAPI.sandbox.getConfig()) || {};
    if (cfg.type !== 'vmware' && cfg.type !== 'qemu') { box.innerHTML = ''; return; }
    const templates = await window.electronAPI.sandbox.listTemplates();
    const tplOpts = templates.map(t => `<option value="${t.key}" ${cfg.vmTemplate === t.key ? 'selected' : ''}>${t.label} (${t.type})</option>`).join('');
    const nets = [
      ['none', 'Kein Internet'], ['localhost', 'Nur localhost'], ['projects', 'Nur Projektserver'],
      ['all', 'Alles'], ['custom', 'Benutzerdefiniert'],
    ];
    const netOpts = nets.map(([v, l]) => `<option value="${v}" ${cfg.network === v ? 'selected' : ''}>${l}</option>`).join('');
    box.innerHTML = `
      <div style="margin-bottom:0.5rem;"><label style="font-weight:600;display:block;margin-bottom:0.2rem;">Betriebssystem-Template</label>
        <select id="sbx-template"><option value="">— Auswählen —</option>${tplOpts}</select>
        <button id="sbx-download" class="btn btn-small" style="margin-top:0.3rem;">Image herunterladen</button>
        <span id="sbx-dl-progress" style="font-size:0.75rem;margin-left:0.5rem;"></span>
      </div>
      <div style="margin-bottom:0.5rem;"><label style="font-weight:600;display:block;margin-bottom:0.2rem;">Netzwerk</label>
        <select id="sbx-network">${netOpts}</select>
      </div>
    `;

    document.getElementById('sbx-template')?.addEventListener('change', async (e) => {
      await window.electronAPI.sandbox.setConfig({ vmTemplate: e.target.value, type: cfg.type });
    });
    document.getElementById('sbx-network')?.addEventListener('change', async (e) => {
      await window.electronAPI.sandbox.setConfig({ network: e.target.value, type: cfg.type });
      await window.electronAPI.sandbox.setNetwork(e.target.value);
    });
    document.getElementById('sbx-download')?.addEventListener('click', async () => {
      const key = document.getElementById('sbx-template')?.value;
      if (!key) return;
      const prog = document.getElementById('sbx-dl-progress');
      if (prog) prog.textContent = 'Download startet...';
      const r = await window.electronAPI.sandbox.downloadImage(key);
      if (prog) prog.textContent = r.ok ? (r.cached ? '✅ Image vorhanden: ' + r.path : '✅ Heruntergeladen: ' + r.path) : '❌ ' + (r.error || 'Fehler');
    });
    if (typeof window.onDownloadProgress === 'function') {
      window.onDownloadProgress((p) => {
        const prog = document.getElementById('sbx-dl-progress');
        if (prog) prog.textContent = 'Download ' + p.pct + '% (' + Math.round(p.received / 1024 / 1024) + '/' + Math.round(p.total / 1024 / 1024) + ' MB)';
      });
    }
  }
};

// Load when settings tab is opened
document.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver(() => {
    if (document.getElementById('sandbox-settings-content')) {
      SandboxSettings.init();
      if (typeof SandboxVmPanel !== 'undefined') SandboxVmPanel.init();
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById('settings-modal') || document.body, { childList: true, subtree: true });
});

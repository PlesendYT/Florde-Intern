// App/renderer/sandbox-wizard.js
const SandboxWizard = {
  _meta: null,
  opened: false,

  SANDBOX_OPTIONS: [
    { type: 'none', label: 'Kleine Sandbox', desc: 'Schnelle, isolierte Umgebung für normale Aufgaben.', pros: ['Sehr schnell', 'Wenig RAM/CPU', 'Gut für Code-Analysen, Tests, kleine Änderungen'], cons: ['Weniger Isolation', 'Bei schweren Fehlern weniger Schutz'] },
    { type: 'firejail', label: 'Firejail Sandbox', desc: 'Leichtgewichtige Linux-Sandbox mit eingeschränkten Rechten.', pros: ['Sehr schnell', 'Wenig RAM/CPU', 'Deutlich bessere Isolation'], cons: ['Nur unter Linux', 'Keine vollständige VM', 'Ungünstig für Vision-Modelle/Desktop'] },
    { type: 'docker', label: 'Docker/Podman Sandbox', desc: 'Die KI arbeitet in einem Container.', pros: ['Gute Isolation', 'Reproduzierbare Umgebung', 'Unterschiedliche Entwicklungsumgebungen'], cons: ['Docker/Podman muss installiert sein', 'Etwas mehr Ressourcen', 'Nicht gleiche Sicherheit wie echte VM'] },
    { type: 'vmware', label: 'VM Sandbox', desc: 'Eine komplette virtuelle Maschine für die KI.', pros: ['Höchste Isolation', 'Eigene Umgebung', 'Riskante Tests möglich', 'Vision-Modelle können sehen und steuern'], cons: ['Viel RAM/CPU nötig', 'Langsamer', 'Einrichtung nötig'] },
  ],

  shouldShow() {
    return !(this._meta && this._meta.configured);
  },

  async _loadConfig() {
    this._meta = (await window.electronAPI.sandbox.getConfig()) || {};
    return this._meta;
  },

  _render(options) {
    const modal = document.getElementById('sandbox-wizard-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const body = modal.querySelector('.wizard-body');
    const list = options.map(o => `
      <div class="sandbox-option" data-type="${o.type}">
        <div class="sandbox-option-head">
          <span class="sandbox-option-name">${o.label}</span>
          <span class="sandbox-option-radio"></span>
        </div>
        <p class="sandbox-option-desc">${o.desc}</p>
        <div class="sandbox-option-pros">${o.pros.map(p => '<span class="pro">✓ ' + p + '</span>').join('')}</div>
        <div class="sandbox-option-cons">${o.cons.map(c => '<span class="con">✗ ' + c + '</span>').join('')}</div>
      </div>`).join('');
    body.innerHTML = `
      <p style="color:var(--text2);font-size:0.9rem;">Wie soll die KI im Sandbox-Mode arbeiten dürfen?</p>
      <div class="sandbox-option-list">${list}</div>
      <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button id="wizard-recommend" class="btn">Empfohlen für deinen PC</button>
        <span id="wizard-recommend-out" style="font-size:0.8rem;color:var(--text3);align-self:center;"></span>
      </div>
      <div id="wizard-recommend-detail" style="margin-top:0.5rem;font-size:0.85rem;"></div>
    `;

    modal.querySelectorAll('.sandbox-option').forEach(el => {
      el.addEventListener('click', () => {
        modal.querySelectorAll('.sandbox-option').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    document.getElementById('wizard-recommend').addEventListener('click', async () => {
      try {
        const spec = await window.electronAPI.sandbox.detect();
        const recs = await window.electronAPI.sandbox.recommend(spec);
        const r = recs[0];
        const detail = document.getElementById('wizard-recommend-detail');
        detail.innerHTML = '<strong>Empfohlen für deinen PC</strong><br>' +
          'CPU &nbsp;✓ ' + spec.cpu.model + '<br>' +
          'RAM &nbsp;✓ ' + spec.ram.total + ' MB<br>' +
          'GPU &nbsp;✓ ' + (spec.gpu.model || 'unbekannt') +
          (spec.gpu.vram > 0 ? ' (' + spec.gpu.vram + ' MB VRAM)' : '') + '<br><br>' +
          '<em>' + r.reason + '</em>';
        const target = modal.querySelector('.sandbox-option[data-type="' + r.type + '"]');
        if (target) {
          modal.querySelectorAll('.sandbox-option').forEach(x => x.classList.remove('selected'));
          target.classList.add('selected');
        }
      } catch (err) {
        if (typeof showNotification === 'function') showNotification('error', 'Empfehlung fehlgeschlagen: ' + err.message);
      }
    });
  },

  _bindActions() {
    const modal = document.getElementById('sandbox-wizard-modal');
    document.getElementById('wizard-save')?.addEventListener('click', async () => {
      const sel = modal?.querySelector('.sandbox-option.selected');
      const type = sel ? sel.dataset.type : 'none';
      await window.electronAPI.sandbox.setConfig({ type, configured: true });
      try { await window.electronAPI.sandbox.switchBackend(type); } catch {}
      if (typeof saveSettingsToDisk === 'function') {
        const s = (() => { try { return JSON.parse(localStorage.getItem('florde-settings') || '{}'); } catch { return {}; } })();
        s.sandbox = { type, configured: true };
        await saveSettingsToDisk(s);
      }
      modal.classList.add('hidden');
      if (typeof showNotification === 'function') showNotification('success', 'Sandbox auf ' + type + ' eingerichtet');
      document.dispatchEvent(new CustomEvent('sandbox:wizard-done', { detail: { type } }));
    });

    document.getElementById('wizard-cancel')?.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  },

  async open() {
    await this._loadConfig();
    if (this.opened) return;
    this.opened = true;
    this._render(this.SANDBOX_OPTIONS);
    this._bindActions();
  },
};

if (typeof module !== 'undefined') module.exports = { SandboxWizard };

// App/renderer/sandbox-vm-panel.js
const SandboxVmPanel = {
  _canvas: null,
  _ctx: null,
  _streaming: false,
  _takeover: false,
  _container: null,

  init() {
    const container = document.getElementById('sandbox-vm-panel');
    if (!container) return;
    this._container = container;
    this._canvas = document.getElementById('vm-canvas');
    this._ctx = this._canvas.getContext('2d');

    document.getElementById('vm-btn-pause')?.addEventListener('click', () => this.pause());
    document.getElementById('vm-btn-stop')?.addEventListener('click', () => this.stopTask());
    document.getElementById('vm-btn-take')?.addEventListener('click', () => this.toggleTakeover());
    document.getElementById('vm-btn-snapshot')?.addEventListener('click', () => this.snapshot());

    if (typeof window.onVmFrame === 'function') {
      window.onVmFrame((frame) => this._draw(frame));
    }

    this._canvas.addEventListener('pointerdown', (e) => this._canvasEvent(e, 'down'));
    this._canvas.addEventListener('pointermove', (e) => this._canvasEvent(e, 'move'));
    this._canvas.addEventListener('pointerup', (e) => this._canvasEvent(e, 'up'));
    this._canvas.addEventListener('keydown', (e) => {
      if (!this._takeover) return;
      const k = e.key === 'Enter' ? 'enter' : e.key === 'Escape' ? 'escape' : e.key === ' ' ? 'space' : e.key;
      e.preventDefault();
      window.electronAPI.sandbox.vmKey(k.toLowerCase());
    });
  },

  _canvasEvent(e, type) {
    if (!this._takeover || !this._canvas) return;
    const r = this._canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left) * (this._canvas.width / r.width));
    const y = Math.round((e.clientY - r.top) * (this._canvas.height / r.height));
    const btn = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    window.electronAPI.sandbox.vmMouse(x, y, type === 'up' ? 0 : 1);
    if (type === 'down' && btn !== 'left') window.electronAPI.sandbox.vmMouse(x, y, btn);
  },

  _draw(frame) {
    if (!this._ctx || !this._canvas || !frame) return;
    if (this._canvas.width !== frame.width) this._canvas.width = frame.width;
    if (this._canvas.height !== frame.height) this._canvas.height = frame.height;
    if (frame.buffer) {
      const img = this._ctx.createImageData(frame.width, frame.height);
      img.data = new Uint8ClampedArray(frame.buffer.slice(0, frame.width * frame.height * 4));
      this._ctx.putImageData(img, 0, 0);
    }
  },

  async show() {
    if (this._container) this._container.classList.remove('hidden');
    await this._startStream();
  },

  async hide() {
    if (this._container) this._container.classList.add('hidden');
    this._stopStream();
  },

  async _startStream() {
    if (this._streaming) return;
    this._streaming = true;
    const r = await window.electronAPI.sandbox.vmStreamStart({ host: '127.0.0.1', port: 5900 });
    if (r && r.ok === false && typeof showNotification === 'function') showNotification('error', 'VNC-Stream fehlgeschlagen: ' + (r.error || 'unbekannt'));
    AuditLog.log({ type: 'vm', action: 'Vision Session gestartet', status: 'auto', summary: 'VM Live-Ansicht gestartet (VNC)', details: {}, source: 'KI' });
  },

  _stopStream() {
    this._streaming = false;
    window.electronAPI.sandbox.vmStreamStop();
  },

  pause() {
    const aborter = _requestAborter;
    if (aborter && aborter.signal && !aborter.signal.aborted) {
      // pause: we only pause new tool calls via a flag
      window._vmPaused = true;
    } else {
      window._vmPaused = true;
    }
    AuditLog.log({ type: 'vm', action: 'KI angehalten (Pause)', status: 'auto', summary: 'KI angehalten (Pause)', details: {}, source: 'User' });
  },

  stopTask() {
    const aborter = _requestAborter;
    if (aborter) aborter.abort();
    window._vmPaused = false;
    AuditLog.log({ type: 'vm', action: 'KI-Aufgabe abgebrochen (Stop)', status: 'auto', summary: 'KI-Aufgabe abgebrochen (Stop)', details: {}, source: 'User' });
    if (typeof showNotification === 'function') showNotification('info', 'KI-Aufgabe abgebrochen');
  },

  toggleTakeover() {
    this._takeover = !this._takeover;
    const btn = document.getElementById('vm-btn-take');
    if (btn) { btn.classList.toggle('active', this._takeover); btn.textContent = this._takeover ? 'Übernehmen (aktiv)' : 'Übernehmen'; }
    if (this._takeover) this._canvas.focus();
    AuditLog.log({ type: 'vm', action: 'Übernehmen ' + (this._takeover ? 'aktiv' : 'deaktiviert'), status: 'auto', summary: 'User-Kontrolle ' + (this._takeover ? 'übernommen' : 'beendet'), details: {}, source: 'User' });
  },

  async snapshot() {
    const name = 'manual-' + Date.now();
    const r = await window.electronAPI.sandbox.vmSnapshot(name);
    if (r && r.ok === false && typeof showNotification === 'function') showNotification('error', 'Snapshot fehlgeschlagen');
    AuditLog.log({ type: 'vm', action: 'Snapshot erstellt', status: 'auto', summary: 'Snapshot erstellt: ' + name, details: { name }, source: 'User' });
  },
};

if (typeof module !== 'undefined') module.exports = { SandboxVmPanel };
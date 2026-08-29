const rfb = require('rfb2');
const { VNCClient } = require('./vnc-client');

class VncStreamer {
  constructor(options = {}) {
    this._opts = { host: options.host || '127.0.0.1', port: options.port || 5900, password: options.password || '' };
    this._client = null;
    this._running = false;
    this._cb = () => {};
    this._framebuffer = null;
  }

  get running() { return this._running; }
  set running(v) { this._running = !!v; }

  onFrame(cb) { if (typeof cb === 'function') this._cb = cb; }

  async start() {
    if (this._running) throw new Error('VNC stream already running');
    this._running = true;
    this._client = new VNCClient(this._opts);
    await this._client.connect();
    const rfbClient = this._client._client;

    const bppBytes = rfbClient.bpp >> 3 || 4;
    this._framebuffer = Buffer.alloc(rfbClient.width * rfbClient.height * bppBytes);

    rfbClient.on('rect', (rect) => {
      const w = rfbClient.width;
      const h = rfbClient.height;
      const bytesPerPixel = rfbClient.bpp >> 3 || 4;

      const isRaw = rect.encoding === rfb.encodings.raw;
      const isPseudo = rect.encoding < 0 || rect.width === 0 || rect.height === 0;

      if (isRaw && !isPseudo && rect.data && this._framebuffer) {
        if (this._framebuffer.length !== w * h * bytesPerPixel) {
          this._framebuffer = Buffer.alloc(w * h * bytesPerPixel);
        }
        const bppY = w * bytesPerPixel;
        for (let line = 0; line < rect.height; line++) {
          const srcStart = line * rect.width * bytesPerPixel;
          const dstStart = (rect.y + line) * bppY + rect.x * bytesPerPixel;
          rect.data.copy(this._framebuffer, dstStart, srcStart, srcStart + rect.width * bytesPerPixel);
        }
      }

      this._cb({ width: w, height: h, buffer: this._framebuffer, bytes: w * h * bytesPerPixel });
    });

    rfbClient.requestUpdate(false, 0, 0, rfbClient.width, rfbClient.height);

    return true;
  }

  stop() {
    if (this._client) this._client.disconnect();
    this._client = null;
    this._framebuffer = null;
    this._running = false;
  }

  sendMouse(x, y, button = 1) { if (this._client) this._client.sendMouse(x, y, button); }
  sendKey(keysym) { if (this._client) this._client.sendKey(keysym); }
}

module.exports = { VncStreamer };

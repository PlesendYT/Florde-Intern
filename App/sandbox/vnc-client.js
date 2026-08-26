const rfb = require('rfb2');

class VNCClient {
  constructor(options = {}) {
    this._host = options.host || '127.0.0.1';
    this._port = options.port || 5900;
    this._password = options.password || '';
    this._client = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this._client = rfb.createConnection({
        host: this._host,
        port: this._port,
        password: this._password,
      });
      this._client.on('connect', () => resolve());
      this._client.on('error', (err) => reject(err));
    });
  }

  sendMouse(x, y, button = 0) {
    this._client.pointerEvent(x, y, button);
  }

  sendKey(keysym) {
    this._client.keyEvent(keysym, true);
    this._client.keyEvent(keysym, false);
  }

  disconnect() {
    if (this._client) {
      this._client.end();
    }
  }
}

module.exports = { VNCClient };

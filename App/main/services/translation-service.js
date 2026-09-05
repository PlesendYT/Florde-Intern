const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');

class TranslationService {
  getCache() {
    try {
      return JSON.parse(fs.readFileSync(this._cachePath(), 'utf-8'));
    } catch { return {}; }
  }

  saveCache(cache) {
    try {
      fs.writeFileSync(this._cachePath(), JSON.stringify(cache, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async translate(text, sourceLang, targetLang) {
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
      const html = await new Promise((resolve, reject) => {
        const req = net.request(url);
        req.on('response', (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => resolve(data));
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      });
      const parsed = JSON.parse(html);
      const translated = parsed[0].map(s => s[0]).join('');
      return { success: true, text: translated };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  _cachePath() {
    return path.join(app.getPath('userData'), 'translations.json');
  }
}

module.exports = { TranslationService };
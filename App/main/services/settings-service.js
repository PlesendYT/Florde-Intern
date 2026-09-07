const fs = require('fs');
const { getSettingsPath } = require('./shared');

class SettingsService {
  get() {
    try {
      return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf-8'));
    } catch { return {}; }
  }

  save(settings) {
    try {
      // Security (F11): API keys must never persist in settings.json (plaintext).
      // Secrets belong in the OS keychain; drop any *Key fields defensively.
      const clean = { ...(settings || {}) };
      for (const k of Object.keys(clean)) {
        if (/key$/i.test(k)) delete clean[k];
      }
      fs.writeFileSync(getSettingsPath(), JSON.stringify(clean, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = { SettingsService };
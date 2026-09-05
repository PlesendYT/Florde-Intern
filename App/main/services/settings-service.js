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
      fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = { SettingsService };
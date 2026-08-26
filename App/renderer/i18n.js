const I18n = {
  _cache: {},
  _currentLang: 'en',
  _sourceLang: 'en',
  _initialized: false,
  _translatedDict: {},

  async init() {
    if (this._initialized) return;
    try {
      const s = await window.electronAPI.getSettings();
      this._currentLang = s.language || 'en';
    } catch { this._currentLang = 'en'; }
    try {
      this._cache = await window.electronAPI.translation.getCache() || {};
    } catch { this._cache = {}; }
    this._initialized = true;
    if (this._currentLang !== this._sourceLang) {
      await this._buildDict();
    }
  },

  t(text) {
    if (!text || this._currentLang === this._sourceLang) return text;
    return this._translatedDict[text] || text;
  },

  async _buildDict() {
    const keys = Object.keys(this._cache).filter(k => k.startsWith(this._sourceLang + ':' + this._currentLang + ':'));
    this._translatedDict = {};
    for (const k of keys) {
      const src = k.slice((this._sourceLang + ':' + this._currentLang + ':').length);
      this._translatedDict[src] = this._cache[k];
    }
  },

  async setLanguage(lang) {
    if (lang === this._currentLang) return;
    this._currentLang = lang;
    if (lang === this._sourceLang) {
      this._translatedDict = {};
    } else {
      await this._buildDict();
      const missing = this._collectAllStrings().filter(s => !this._translatedDict[s]);
      if (missing.length > 0) await this._fetchBatch(missing);
      await this._buildDict();
    }
    await this.applyToPage();
    this._fireCustomEvent();
  },

  _fireCustomEvent() {
    window.dispatchEvent(new CustomEvent('i18n-changed', { detail: { lang: this._currentLang } }));
  },

  _collectAllStrings() {
    const strings = new Set();
    document.querySelectorAll('[lang-key]').forEach(el => {
      const orig = el.getAttribute('lang-key-orig');
      if (orig) strings.add(orig);
    });
    return [...strings];
  },

  async translate(text) {
    if (!text || !text.trim()) return text;
    if (this._currentLang === this._sourceLang) return text;
    const cacheKey = `${this._sourceLang}:${this._currentLang}:${text}`;
    if (this._cache[cacheKey]) return this._cache[cacheKey];
    try {
      const result = await window.electronAPI.translation.translate(text, this._sourceLang, this._currentLang);
      if (result.success && result.text) {
        this._cache[cacheKey] = result.text;
        this._translatedDict[text] = result.text;
        this._saveCacheDebounced();
        return result.text;
      }
    } catch {}
    return text;
  },

  async _fetchBatch(texts) {
    const batches = [];
    for (let i = 0; i < texts.length; i += 5) {
      batches.push(texts.slice(i, i + 5));
    }
    for (const batch of batches) {
      const results = await Promise.all(
        batch.map(text => window.electronAPI.translation.translate(text, this._sourceLang, this._currentLang))
      );
      batch.forEach((text, idx) => {
        if (results[idx].success && results[idx].text) {
          this._cache[`${this._sourceLang}:${this._currentLang}:${text}`] = results[idx].text;
        }
      });
    }
    this._saveCacheDebounced();
  },

  _saveTimer: null,
  _saveCacheDebounced() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      window.electronAPI.translation.saveCache(this._cache).catch(() => {});
    }, 2000);
  },

  async applyToPage() {
    if (this._currentLang === this._sourceLang) {
      document.querySelectorAll('[lang-key]').forEach(el => {
        const orig = el.getAttribute('lang-key-orig');
        if (orig !== null) {
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = orig;
          else el.textContent = orig;
        }
      });
      document.documentElement.lang = this._currentLang;
      return;
    }
    const elements = document.querySelectorAll('[lang-key]');
    const textsToTranslate = [];
    const elementMap = [];
    elements.forEach(el => {
      const orig = el.getAttribute('lang-key-orig');
      if (orig === null) {
        const current = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? el.placeholder : el.textContent;
        el.setAttribute('lang-key-orig', current.trim());
      }
      const originalText = el.getAttribute('lang-key-orig');
      if (originalText) {
        textsToTranslate.push(originalText);
        elementMap.push(el);
      }
    });
    const uniqueTexts = [...new Set(textsToTranslate)];
    const translations = {};
    const toFetch = [];
    for (const text of uniqueTexts) {
      const cacheKey = `${this._sourceLang}:${this._currentLang}:${text}`;
      if (this._cache[cacheKey]) {
        translations[text] = this._cache[cacheKey];
      } else {
        toFetch.push(text);
      }
    }
    if (toFetch.length > 0) {
      await this._fetchBatch(toFetch);
      for (const text of uniqueTexts) {
        const cacheKey = `${this._sourceLang}:${this._currentLang}:${text}`;
        translations[text] = this._cache[cacheKey] || text;
      }
    }
    elementMap.forEach(el => {
      const originalText = el.getAttribute('lang-key-orig');
      const translated = translations[originalText] || originalText;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = translated;
      else el.textContent = translated;
    });
    document.documentElement.lang = this._currentLang;
  }
};

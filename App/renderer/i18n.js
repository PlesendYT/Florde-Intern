const I18n = {
  _cache: {},
  _currentLang: 'en',
  _sourceLang: 'en',
  _initialized: false,
  _translatedDict: {},
  // Security (b-44): translation cache is bounded — oldest entries pruned.
  _CACHE_MAX: 2000,

  _setCache(key, val) {
    if (typeof key !== 'string' || typeof val !== 'string') return;
    if (!this._cache[key] && Object.keys(this._cache).length >= this._CACHE_MAX) {
      const oldest = Object.keys(this._cache).slice(0, Math.floor(this._CACHE_MAX / 4));
      for (const k of oldest) delete this._cache[k];
    }
    this._cache[key] = val;
  },

  async init() {
    if (this._initialized) return;
    try {
      const s = await window.electronAPI.getSettings();
      this._currentLang = s.language || 'en';
    } catch { this._currentLang = 'en'; }
    try {
      const loaded = await window.electronAPI.translation.getCache() || {};
      // Guard persisted cache: plain object of short strings, capped.
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        const entries = Object.entries(loaded)
          .filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && k.length < 500 && v.length < 2000)
          .slice(-this._CACHE_MAX);
        this._cache = Object.fromEntries(entries);
      } else {
        this._cache = {};
      }
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
      if (result && result.success && result.text) {
        this._setCache(cacheKey, result.text);
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
      // Security (b-44): per-item result guard — one failing translation
      // must not reject the whole batch (Promise.all) or crash on
      // undefined results.
      const results = await Promise.all(
        batch.map(text => window.electronAPI.translation.translate(text, this._sourceLang, this._currentLang)
          .catch(() => null))
      );
      batch.forEach((text, idx) => {
        const r = results[idx];
        if (r && r.success && r.text) {
          this._setCache(`${this._sourceLang}:${this._currentLang}:${text}`, r.text);
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

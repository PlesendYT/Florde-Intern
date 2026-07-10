const SearchReplace = {
  _replaceVisible: false,

  init() {
    this._replaceVisible = false;
  },

  toggleReplace() {
    this._replaceVisible = !this._replaceVisible;
    const searchModal = document.getElementById('search-modal');
    if (!searchModal) return;
    let replaceRow = document.getElementById('search-replace-row');
    if (this._replaceVisible && !replaceRow) {
      replaceRow = document.createElement('div');
      replaceRow.id = 'search-replace-row';
      replaceRow.style.cssText = 'display:flex;gap:8px;margin-top:8px;';
      replaceRow.innerHTML =
        '<input type="text" id="replace-input" placeholder="Replace with..." style="flex:1;" />' +
        '<button id="btn-replace-one" class="btn btn-secondary btn-sm">Replace</button>' +
        '<button id="btn-replace-all" class="btn btn-secondary btn-sm">All</button>';
      const inputRow = searchModal.querySelector('.settings-form > div');
      if (inputRow) inputRow.parentNode.insertBefore(replaceRow, inputRow.nextSibling);

      document.getElementById('btn-replace-one').addEventListener('click', () => this._replaceOne());
      document.getElementById('btn-replace-all').addEventListener('click', () => this._replaceAll());
    } else if (!this._replaceVisible && replaceRow) {
      replaceRow.remove();
    }
  },

  find(text) {
    if (typeof editor === 'undefined' || !editor) return [];
    const model = editor.getModel();
    if (!model) return [];
    const matches = model.findMatches(text, false, false, false, null, false);
    return matches.map(m => ({
      range: m.range,
      text: model.getValueInRange(m.range),
    }));
  },

  replace(text, replacement) {
    if (typeof editor === 'undefined' || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches(text, false, false, false, null, false);
    if (matches.length === 0) return;
    const operations = matches.map(m => ({ range: m.range, text: replacement }));
    editor.executeEdits('search-replace', operations);
  },

  _replaceOne() {
    const searchInput = document.getElementById('search-input');
    const replaceInput = document.getElementById('replace-input');
    if (!searchInput || !replaceInput) return;
    const text = searchInput.value.trim();
    const replacement = replaceInput.value;
    if (!text) return;
    if (typeof editor === 'undefined' || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    const matches = model.findMatches(text, false, false, false, null, false);
    if (matches.length === 0) return;
    editor.executeEdits('search-replace', [{ range: matches[0].range, text: replacement }]);
  },

  _replaceAll() {
    const searchInput = document.getElementById('search-input');
    const replaceInput = document.getElementById('replace-input');
    if (!searchInput || !replaceInput) return;
    const text = searchInput.value.trim();
    const replacement = replaceInput.value;
    if (!text) return;
    this.replace(text, replacement);
  }
};

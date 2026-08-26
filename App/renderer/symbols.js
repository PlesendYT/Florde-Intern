// App/renderer/symbols.js
function _stripComments(lines, lang) {
  if (lang === 'python') {
    return lines.map(l => l.replace(/#.*$/, ''));
  }
  return lines.map(l => l.replace(/\/\/.*$/, ''));
}

function _matchAll(line, regex) {
  const out = [];
  let m;
  const r = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = r.exec(line)) !== null) {
    out.push(m);
    if (m[0] === '') r.lastIndex++;
  }
  return out;
}

function extractSymbols(content, language) {
  const lang = (language || '').toLowerCase();
  const lines = _stripComments(String(content || '').split('\n'), lang);
  const syms = [];
  const push = (name, kind, idx) => {
    if (name) syms.push({ name, kind, line: idx + 1, preview: lines[idx].trim().slice(0, 80) });
  };

  lines.forEach((line, i) => {
    if (lang === 'python') {
      _matchAll(line, /\bdef\s+([A-Za-z_]\w*)/).forEach(m => push(m[1], 'function', i));
      _matchAll(line, /\bclass\s+([A-Za-z_]\w*)/).forEach(m => push(m[1], 'class', i));
    } else if (lang === 'html') {
      _matchAll(line, /id="([^"]+)"/).forEach(m => push(m[1], 'id', i));
      _matchAll(line, /class="([^"]+)"/).forEach(m => {
        m[1].split(/\s+/).forEach(c => c && push(c, 'class', i));
      });
    } else if (lang === 'css') {
      _matchAll(line, /^\s*(\.-?[_a-zA-Z][\w-]*)/).forEach(m => push(m[1], 'class', i));
      _matchAll(line, /^\s*(#-?[_a-zA-Z][\w-]*)/).forEach(m => push(m[1], 'id', i));
    } else {
      _matchAll(line, /\bfunction\s+([A-Za-z_$][\w$]*)/).forEach(m => push(m[1], 'function', i));
      _matchAll(line, /\bclass\s+([A-Za-z_$][\w$]*)/).forEach(m => push(m[1], 'class', i));
      _matchAll(line, /\b(const|let|var)\s+([A-Za-z_$][\w$]*)/).forEach(m => push(m[2], 'variable', i));
      _matchAll(line, /^\s*([A-Za-z_$][\w$]*)\s*=/).forEach(m => push(m[1], 'variable', i));
      _matchAll(line, /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/).forEach(m => push(m[1], 'method', i));
      _matchAll(line, /^\s*([A-Za-z_$][\w$]*)\s*:\s*(function|\()/).forEach(m => push(m[1], 'method', i));
      _matchAll(line, /\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)/).forEach(m => push(m[1], 'function', i));
    }
  });
  return syms;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractSymbols };
}

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySecretProtection } from '../domains/security/secrets.js';

function stubInput(attrs = {}) {
  const el = {
    tagName: 'INPUT',
    type: attrs.type || 'text',
    spellcheck: true,
    autocapitalize: 'on',
    _attrs: { ...(attrs.attrs || {}) },
    getAttribute(name) { return this._attrs[name] ?? null; },
    setAttribute(name, value) { this._attrs[name] = value; },
  };
  return el;
}

test('forces password masking and safe attrs on tagged inputs', () => {
  const tagged = stubInput();
  const other = stubInput();
  other.tagName = 'DIV';
  const root = { querySelectorAll: (sel) => (sel === '[data-secret]' ? [tagged, other] : []) };
  const count = applySecretProtection(root);
  assert.strictEqual(count, 1);
  assert.strictEqual(tagged.type, 'password');
  assert.strictEqual(tagged.getAttribute('autocomplete'), 'new-password');
  assert.strictEqual(tagged.spellcheck, false);
  assert.strictEqual(tagged.autocapitalize, 'off');
});

test('keeps already-masked inputs masked', () => {
  const el = stubInput({ type: 'password' });
  const root = { querySelectorAll: () => [el] };
  assert.strictEqual(applySecretProtection(root), 1);
  assert.strictEqual(el.type, 'password');
});

test('handles missing root gracefully', () => {
  assert.strictEqual(applySecretProtection(null), 0);
  assert.strictEqual(applySecretProtection({}), 0);
});

test('every key/token input in index.html carries the Secrets tag and masking', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
  const keyInputs = [...html.matchAll(/<input[^>]*id="(key-[a-z]+|app-connect-key)"[^>]*>/g)];
  assert.ok(keyInputs.length >= 11, `expected at least 11 secret inputs, found ${keyInputs.length}`);
  for (const [tag] of keyInputs) {
    assert.ok(tag.includes('data-secret="true"'), `missing Secrets tag: ${tag.slice(0, 80)}`);
    assert.ok(tag.includes('type="password"'), `missing password masking: ${tag.slice(0, 80)}`);
  }
});

test('dynamic route key template carries the Secrets tag', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const js = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf-8');
  const m = js.match(/<input[^>]*data-field="key"[^>]*>/);
  assert.ok(m, 'route key template not found');
  assert.ok(m[0].includes('data-secret="true"'), 'route key template missing Secrets tag');
  assert.ok(m[0].includes('type="password"'), 'route key template missing password masking');
});

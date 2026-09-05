import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePluginManifest,
  ensurePluginId,
  localPluginDefaults,
} from '../domains/marketplace/manifest.js';

describe('parsePluginManifest', () => {
  it('parses valid JSON and merges manifest over base', () => {
    const base = { id: 'local-1', name: 'Local Plugin', version: '1.0.0' };
    const r = parsePluginManifest('{"name":"My Plugin","version":"2.0.0"}', base);
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, {
      id: 'local-1',
      name: 'My Plugin',
      version: '2.0.0',
    });
  });

  it('returns { ok:false, data:base } on invalid JSON without throwing', () => {
    const base = { id: 'local-1', name: 'Local Plugin' };
    assert.doesNotThrow(() => parsePluginManifest('not json', base));
    assert.deepEqual(parsePluginManifest('not json', base), {
      ok: false,
      data: base,
    });
    assert.deepEqual(parsePluginManifest('{', base), {
      ok: false,
      data: base,
    });
  });

  it('defaults base to {} when not provided', () => {
    assert.deepEqual(parsePluginManifest('{"a":1}'), {
      ok: true,
      data: { a: 1 },
    });
  });

  it('returns a NEW object and does not mutate the base argument', () => {
    const base = { id: 'local-1', name: 'Local Plugin' };
    const r = parsePluginManifest('{"name":"Changed"}', base);
    assert.notEqual(r.data, base);
    assert.equal(base.name, 'Local Plugin');
  });
});

describe('ensurePluginId', () => {
  it('returns SAME object when id present (no clone overwrite)', () => {
    const manifest = { id: 'custom', name: 'X' };
    const r = ensurePluginId(manifest);
    assert.equal(r, manifest);
    assert.equal(r.id, 'custom');
  });

  it('fills local-<now>() when id absent using injected now', () => {
    const r = ensurePluginId({ name: 'X' }, () => 42);
    assert.equal(r.id, 'local-42');
    assert.equal(r.name, 'X');
  });

  it('does not mutate input: input without id stays without id', () => {
    const input = { name: 'X' };
    ensurePluginId(input, () => 42);
    assert.equal(input.id, undefined);
  });
});

describe('localPluginDefaults', () => {
  it('uses injected idNow for id and matches the handler base literal', () => {
    const d = localPluginDefaults(() => 7);
    assert.equal(d.id, 'local-7');
    assert.deepEqual(d, {
      id: 'local-7',
      name: 'Local Plugin',
      version: '1.0.0',
      description: 'Local development plugin',
      author: 'Developer',
      installed: true,
      enabled: true,
      builtin: false,
      local: true,
    });
  });

  it('produces a non-empty local- id with no argument', () => {
    const d = localPluginDefaults();
    assert.ok(d.id.startsWith('local-'));
    assert.ok(d.id.length > 'local-'.length);
  });
});

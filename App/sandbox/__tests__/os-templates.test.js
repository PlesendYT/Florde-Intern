// App/sandbox/__tests__/os-templates.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { TEMPLATES, getTemplate, listTemplates } = require('../os-templates');

describe('os-templates', () => {
  it('should export TEMPLATES object', () => {
    assert.ok(typeof TEMPLATES === 'object');
  });

  it('should export getTemplate function', () => {
    assert.strictEqual(typeof getTemplate, 'function');
  });

  it('should export listTemplates function', () => {
    assert.strictEqual(typeof listTemplates, 'function');
  });

  it('should have at least ubuntu and ubuntuDesktop templates', () => {
    assert.ok(TEMPLATES.ubuntu);
    assert.ok(TEMPLATES.ubuntuDesktop);
  });

  it('each template should have label, type, image, ram, cpu, disk', () => {
    for (const [key, tmpl] of Object.entries(TEMPLATES)) {
      if (key === 'custom') continue;
      assert.ok(tmpl.label, `${key} missing label`);
      assert.ok(['headless', 'desktop'].includes(tmpl.type), `${key} invalid type`);
      assert.ok(tmpl.image, `${key} missing image`);
      assert.ok(tmpl.ram > 0, `${key} invalid ram`);
      assert.ok(tmpl.cpu > 0, `${key} invalid cpu`);
      assert.ok(tmpl.disk > 0, `${key} invalid disk`);
    }
  });

  it('custom template should allow null image/username/password', () => {
    assert.strictEqual(TEMPLATES.custom.image, null);
    assert.strictEqual(TEMPLATES.custom.username, null);
    assert.strictEqual(TEMPLATES.custom.password, null);
  });

  it('getTemplate should return template by key', () => {
    const t = getTemplate('ubuntu');
    assert.strictEqual(t.label, 'Ubuntu Server');
  });

  it('getTemplate should throw for unknown template', () => {
    assert.throws(() => getTemplate('nonexistent'), /Unknown template/);
  });

  it('listTemplates should return array of { key, label, type }', () => {
    const list = listTemplates();
    assert.ok(Array.isArray(list));
    assert.ok(list.some(t => t.key === 'ubuntu'));
    assert.ok(list.every(t => t.key && t.label));
  });
});

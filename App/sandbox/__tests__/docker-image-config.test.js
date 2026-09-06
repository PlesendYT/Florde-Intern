const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DockerBackend } = require('../backends/docker');

test('default image is florde/sandbox:bookworm', () => {
  const b = new DockerBackend('/tmp/x');
  assert.equal(b._image, 'florde/sandbox:bookworm');
});

test('custom image option overrides default', () => {
  const b = new DockerBackend('/tmp/x', { image: 'my/image:1' });
  assert.equal(b._image, 'my/image:1');
});

test('project hash is stable and derived from project', () => {
  const b1 = new DockerBackend('/tmp/x', { project: 'projA' });
  const b2 = new DockerBackend('/tmp/y', { project: 'projA' });
  const b3 = new DockerBackend('/tmp/z', { project: 'projB' });
  assert.equal(b1.projectHash, b2.projectHash);
  assert.notEqual(b1.projectHash, b3.projectHash);
});

test('Dockerfile exists and uses debian:bookworm-slim base', () => {
  const df = fs.readFileSync(path.join(__dirname, '..', '..', 'docker', 'sandbox', 'Dockerfile'), 'utf-8');
  assert.ok(df.includes('FROM debian:bookworm-slim'));
  assert.ok(df.includes('florde/sandbox:bookworm') === false); // Tag wird im Backend gesetzt
  assert.ok(df.includes('git'));
  assert.ok(df.includes('curl'));
  assert.ok(df.includes('python3'));
});

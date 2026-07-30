const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { NoneBackend } = require('../backends/none');

describe('NoneBackend', () => {
  let sandboxDir;
  let backend;

  before(() => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'none-backend-test-'));
    backend = new NoneBackend(sandboxDir);
  });

  after(() => {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('should have type "none"', () => {
      assert.strictEqual(backend.type, 'none');
    });

    it('should have a label', () => {
      assert.ok(typeof backend.label === 'string');
      assert.ok(backend.label.length > 0);
    });

    it('should have a description', () => {
      assert.ok(typeof backend.description === 'string');
      assert.ok(backend.description.length > 0);
    });
  });

  describe('isAvailable', () => {
    it('should return true', async () => {
      assert.strictEqual(await backend.isAvailable(), true);
    });
  });

  describe('exec', () => {
    it('should execute a valid command and return ok', async () => {
      const result = await backend.exec('echo hello');
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.code, 0);
      assert.ok(result.output.includes('hello'));
    });

    it('should reject path traversal via cwd', async () => {
      const result = await backend.exec('echo safe', { cwd: '/etc' });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, -1);
      assert.ok(result.output.includes('Access denied'));
    });

    it('should reject path traversal via relative cwd outside sandbox', async () => {
      const result = await backend.exec('pwd', { cwd: '..' });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, -1);
      assert.ok(result.output.includes('Access denied'));
    });

    it('should reject unsafe characters (;)', async () => {
      const result = await backend.exec('echo a; echo b');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, -1);
      assert.ok(result.output.includes('unsafe characters'));
    });

    it('should reject unsafe characters (&)', async () => {
      const result = await backend.exec('echo a & echo b');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, -1);
    });

    it('should reject unsafe characters (`)', async () => {
      const result = await backend.exec('echo `whoami`');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, -1);
    });

    it('should reject unsafe characters ($)', async () => {
      const result = await backend.exec('echo $HOME');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, -1);
    });

    it('should reject unsafe characters (|)', async () => {
      const result = await backend.exec('echo a | cat');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, -1);
    });

    it('should reject unsafe characters (newline)', async () => {
      const result = await backend.exec('echo a\n echo b');
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.code, -1);
    });

    it('should respect timeout and return error', async () => {
      const start = Date.now();
      const result = await backend.exec('sleep 10', { timeout: 100 });
      const elapsed = Date.now() - start;
      assert.strictEqual(result.ok, false);
      assert.ok(elapsed < 5000, 'should have timed out quickly');
    });

    it('should use sandboxDir as default cwd', async () => {
      const result = await backend.exec('pwd');
      assert.strictEqual(result.ok, true);
      assert.ok(result.output.trim().endsWith(path.basename(sandboxDir)));
    });
  });

  describe('readFile', () => {
    it('should read a file within sandbox', async () => {
      const testPath = path.join(sandboxDir, 'test-read.txt');
      fs.writeFileSync(testPath, 'readme content', 'utf-8');
      const content = await backend.readFile('test-read.txt');
      assert.strictEqual(content, 'readme content');
    });

    it('should throw for path traversal attempts', async () => {
      await assert.rejects(
        () => backend.readFile('../etc/passwd'),
        { message: 'Access denied' }
      );
    });

    it('should throw for absolute path outside sandbox', async () => {
      await assert.rejects(
        () => backend.readFile('/etc/passwd'),
        { message: 'Access denied' }
      );
    });

    it('should reject sibling dir with similar prefix (path.sep guard)', async () => {
      const evilBasename = path.basename(sandboxDir) + '_evil';
      const evilPath = path.join('..', evilBasename, 'file.txt');
      await assert.rejects(
        () => backend.readFile(evilPath),
        { message: 'Access denied' }
      );
    });
  });

  describe('writeFile', () => {
    it('should write a file within sandbox', async () => {
      await backend.writeFile('test-write.txt', 'written content');
      const content = fs.readFileSync(path.join(sandboxDir, 'test-write.txt'), 'utf-8');
      assert.strictEqual(content, 'written content');
    });

    it('should create intermediate directories', async () => {
      await backend.writeFile('sub/deep/test.txt', 'nested content');
      const content = fs.readFileSync(path.join(sandboxDir, 'sub/deep/test.txt'), 'utf-8');
      assert.strictEqual(content, 'nested content');
    });

    it('should throw for path traversal attempts', async () => {
      await assert.rejects(
        () => backend.writeFile('../outside.txt', 'content'),
        { message: 'Access denied' }
      );
    });
  });

  describe('listFiles', () => {
    it('should list files in the sandbox directory', async () => {
      fs.writeFileSync(path.join(sandboxDir, 'list-a.txt'), '');
      fs.writeFileSync(path.join(sandboxDir, 'list-b.txt'), '');
      const files = await backend.listFiles('');
      assert.ok(files.includes('list-a.txt'));
      assert.ok(files.includes('list-b.txt'));
    });

    it('should list files in a subdirectory', async () => {
      fs.mkdirSync(path.join(sandboxDir, 'sublist'), { recursive: true });
      fs.writeFileSync(path.join(sandboxDir, 'sublist', 'c.txt'), '');
      const files = await backend.listFiles('sublist');
      assert.ok(files.includes('c.txt'));
    });

    it('should throw for path traversal attempts', async () => {
      await assert.rejects(
        () => backend.listFiles('../etc'),
        { message: 'Access denied' }
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete a file within sandbox', async () => {
      const testPath = path.join(sandboxDir, 'to-delete.txt');
      fs.writeFileSync(testPath, 'bye');
      await backend.deleteFile('to-delete.txt');
      assert.strictEqual(fs.existsSync(testPath), false);
    });

    it('should throw for path traversal attempts', async () => {
      await assert.rejects(
        () => backend.deleteFile('../outside.txt'),
        { message: 'Access denied' }
      );
    });
  });
});

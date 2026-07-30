const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { FirejailBackend } = require('../backends/firejail');

describe('FirejailBackend', () => {
  let workspaceDir;
  let backend;

  before(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'firejail-backend-test-'));
    backend = new FirejailBackend(workspaceDir);
  });

  after(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('should have type "firejail"', () => {
      assert.strictEqual(backend.type, 'firejail');
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
    it('should return true when firejail is installed', async () => {
      assert.strictEqual(await backend.isAvailable(), true);
    });
  });

  describe('init', () => {
    it('should create the firejail profile directory and file', async () => {
      const profileDir = path.dirname(backend._profilePath);
      if (fs.existsSync(profileDir)) {
        fs.rmSync(profileDir, { recursive: true, force: true });
      }

      await backend.init();

      assert.ok(fs.existsSync(backend._profilePath), 'profile file should exist');
      const content = fs.readFileSync(backend._profilePath, 'utf-8');
      assert.ok(content.includes('whitelist ' + workspaceDir));
      assert.ok(content.includes('read-only /'));
      assert.ok(backend.initialized);
    });
  });

  describe('unsafe characters detection', () => {
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
  });

  describe('readFile', () => {
    it('should read a file within sandbox', async () => {
      const testPath = path.join(workspaceDir, 'test-read.txt');
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
      const evilBasename = path.basename(workspaceDir) + '_evil';
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
      const content = fs.readFileSync(path.join(workspaceDir, 'test-write.txt'), 'utf-8');
      assert.strictEqual(content, 'written content');
    });

    it('should create intermediate directories', async () => {
      await backend.writeFile('sub/deep/test.txt', 'nested content');
      const content = fs.readFileSync(path.join(workspaceDir, 'sub/deep/test.txt'), 'utf-8');
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
    it('should list files in the workspace directory', async () => {
      fs.writeFileSync(path.join(workspaceDir, 'list-a.txt'), '');
      fs.writeFileSync(path.join(workspaceDir, 'list-b.txt'), '');
      const files = await backend.listFiles('');
      assert.ok(files.includes('list-a.txt'));
      assert.ok(files.includes('list-b.txt'));
    });

    it('should list files in a subdirectory', async () => {
      fs.mkdirSync(path.join(workspaceDir, 'sublist'), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir, 'sublist', 'c.txt'), '');
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
      const testPath = path.join(workspaceDir, 'to-delete.txt');
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

  describe('destroy', () => {
    it('should set initialized to false', () => {
      backend._initialized = true;
      backend.destroy();
      assert.strictEqual(backend._initialized, false);
    });
  });
});

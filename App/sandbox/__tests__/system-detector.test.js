const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const cp = require('node:child_process');

const { SystemDetector } = require('../system-detector');

describe('SystemDetector', () => {
  describe('detect (shape contract)', () => {
    let spec;

    before(async () => {
      spec = await SystemDetector.detect();
    });

    it('should return cpu with model and cores', () => {
      assert.ok(typeof spec.cpu.model === 'string');
      assert.ok(spec.cpu.model.length > 0);
      assert.ok(Number.isInteger(spec.cpu.cores));
      assert.ok(spec.cpu.cores >= 1);
    });

    it('should return ram with total in MB', () => {
      assert.ok(Number.isInteger(spec.ram.total));
      assert.ok(spec.ram.total >= 128);
    });

    it('should return gpu with model and vram', () => {
      assert.ok(typeof spec.gpu.model === 'string');
      assert.ok(typeof spec.gpu.vram === 'number');
      assert.ok(spec.gpu.vram >= 0);
    });

    it('should return os with platform and distro', () => {
      assert.ok(typeof spec.os.platform === 'string');
      assert.ok(spec.os.platform.length > 0);
      assert.ok(typeof spec.os.distro === 'string');
      assert.ok(spec.os.distro.length > 0);
    });

    it('should return tools as booleans', () => {
      assert.ok(typeof spec.tools.docker === 'boolean');
      assert.ok(typeof spec.tools.podman === 'boolean');
      assert.ok(typeof spec.tools.firejail === 'boolean');
      assert.ok(typeof spec.tools.vmware === 'boolean');
    });

    it('should have all expected top-level keys', () => {
      assert.deepStrictEqual(Object.keys(spec).sort(), ['cpu', 'gpu', 'os', 'ram', 'tools'].sort());
    });
  });

  describe('_checkBinary', () => {
    it('should return true for a known binary (node)', async () => {
      const result = await SystemDetector._checkBinary('node');
      assert.strictEqual(result, true);
    });

    it('should return false for a non-existent binary', async () => {
      const result = await SystemDetector._checkBinary('nonexistentbinaryxyz123');
      assert.strictEqual(result, false);
    });
  });

  describe('recommend', () => {
    it('should always include none as first fallback', async () => {
      const spec = {
        ram: { total: 0 },
        cpu: { cores: 0 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: false, podman: false, firejail: false, vmware: false },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      assert.ok(recs.length >= 1);
      assert.strictEqual(recs[0].type, 'none');
    });

    it('should return only none when no tools available', async () => {
      const spec = {
        ram: { total: 65536 },
        cpu: { cores: 16 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: false, podman: false, firejail: false, vmware: false },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      assert.strictEqual(recs.length, 1);
      assert.strictEqual(recs[0].type, 'none');
    });

    it('should recommend firejail on linux when available and low ram', async () => {
      const spec = {
        ram: { total: 4096 },
        cpu: { cores: 2 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: false, podman: false, firejail: true, vmware: false },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const fj = recs.find(r => r.type === 'firejail');
      assert.ok(fj);
      assert.strictEqual(fj.score, 5);
    });

    it('should recommend firejail with lower score when ram is high', async () => {
      const spec = {
        ram: { total: 16384 },
        cpu: { cores: 2 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: false, podman: false, firejail: true, vmware: false },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const fj = recs.find(r => r.type === 'firejail');
      assert.ok(fj);
      assert.strictEqual(fj.score, 3);
    });

    it('should not recommend firejail on non-linux', async () => {
      const spec = {
        ram: { total: 4096 },
        cpu: { cores: 2 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: false, podman: false, firejail: true, vmware: false },
        os: { platform: 'win32' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const fj = recs.find(r => r.type === 'firejail');
      assert.strictEqual(fj, undefined);
    });

    it('should recommend docker when available and enough ram/cores', async () => {
      const spec = {
        ram: { total: 16384 },
        cpu: { cores: 4 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: true, podman: false, firejail: false, vmware: false },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const d = recs.find(r => r.type === 'docker');
      assert.ok(d);
      assert.strictEqual(d.score, 5);
    });

    it('should not recommend docker with low ram', async () => {
      const spec = {
        ram: { total: 4096 },
        cpu: { cores: 4 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: true, podman: false, firejail: false, vmware: false },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const d = recs.find(r => r.type === 'docker');
      assert.strictEqual(d, undefined);
    });

    it('should not recommend docker with too few cores', async () => {
      const spec = {
        ram: { total: 16384 },
        cpu: { cores: 1 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: true, podman: false, firejail: false, vmware: false },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const d = recs.find(r => r.type === 'docker');
      assert.strictEqual(d, undefined);
    });

    it('should recommend podman with score 0.5 below docker', async () => {
      const spec = {
        ram: { total: 16384 },
        cpu: { cores: 4 },
        gpu: { model: 'none', vram: 0 },
        tools: { docker: true, podman: true, firejail: false, vmware: false },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const d = recs.find(r => r.type === 'docker');
      const p = recs.find(r => r.type === 'podman');
      assert.ok(d);
      assert.ok(p);
      assert.strictEqual(p.score, d.score - 0.5);
    });

    it('should recommend vmware when available and enough ram/cores/vram', async () => {
      const spec = {
        ram: { total: 32768 },
        cpu: { cores: 8 },
        gpu: { model: 'NVIDIA', vram: 8192 },
        tools: { docker: false, podman: false, firejail: false, vmware: true },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const v = recs.find(r => r.type === 'vmware');
      assert.ok(v);
      assert.strictEqual(v.score, 4);
    });

    it('should not recommend vmware with low ram', async () => {
      const spec = {
        ram: { total: 8192 },
        cpu: { cores: 8 },
        gpu: { model: 'NVIDIA', vram: 8192 },
        tools: { docker: false, podman: false, firejail: false, vmware: true },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const v = recs.find(r => r.type === 'vmware');
      assert.strictEqual(v, undefined);
    });

    it('should not recommend vmware with too few cores', async () => {
      const spec = {
        ram: { total: 32768 },
        cpu: { cores: 2 },
        gpu: { model: 'NVIDIA', vram: 8192 },
        tools: { docker: false, podman: false, firejail: false, vmware: true },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      const v = recs.find(r => r.type === 'vmware');
      assert.strictEqual(v, undefined);
    });

    describe('vision model edge cases', () => {
      it('should lower docker score when vision model and low ram', async () => {
        const spec = {
          ram: { total: 8192 },
          cpu: { cores: 4 },
          gpu: { model: 'none', vram: 0 },
          tools: { docker: true, podman: false, firejail: false, vmware: false },
          os: { platform: 'linux' },
          hasVisionModel: true,
        };
        const recs = await SystemDetector.recommend(spec);
        const d = recs.find(r => r.type === 'docker');
        assert.ok(d);
        assert.strictEqual(d.score, 2);
      });

      it('should give vmware score 5 with vision, high ram, and sufficient vram', async () => {
        const spec = {
          ram: { total: 65536 },
          cpu: { cores: 8 },
          gpu: { model: 'NVIDIA', vram: 8192 },
          tools: { docker: false, podman: false, firejail: false, vmware: true },
          os: { platform: 'linux' },
          hasVisionModel: true,
        };
        const recs = await SystemDetector.recommend(spec);
        const v = recs.find(r => r.type === 'vmware');
        assert.ok(v);
        assert.strictEqual(v.score, 5);
      });

      it('should give vmware score 3 with vision, moderate ram, and sufficient vram', async () => {
        const spec = {
          ram: { total: 16384 },
          cpu: { cores: 8 },
          gpu: { model: 'NVIDIA', vram: 8192 },
          tools: { docker: false, podman: false, firejail: false, vmware: true },
          os: { platform: 'linux' },
          hasVisionModel: true,
        };
        const recs = await SystemDetector.recommend(spec);
        const v = recs.find(r => r.type === 'vmware');
        assert.ok(v);
        assert.strictEqual(v.score, 3);
      });

      it('should give vmware score 1 when vision model but insufficient vram', async () => {
        const spec = {
          ram: { total: 32768 },
          cpu: { cores: 8 },
          gpu: { model: 'Integrated', vram: 1024 },
          tools: { docker: false, podman: false, firejail: false, vmware: true },
          os: { platform: 'linux' },
          hasVisionModel: true,
        };
        const recs = await SystemDetector.recommend(spec);
        const v = recs.find(r => r.type === 'vmware');
        assert.ok(v);
        assert.strictEqual(v.score, 1);
        assert.ok(v.reason.includes('VRAM'));
      });
    });

    it('should return recommendations sorted by score descending', async () => {
      const spec = {
        ram: { total: 65536 },
        cpu: { cores: 16 },
        gpu: { model: 'NVIDIA', vram: 8192 },
        tools: { docker: true, podman: true, firejail: true, vmware: true },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      for (let i = 1; i < recs.length; i++) {
        assert.ok(recs[i].score <= recs[i - 1].score, `${i} not sorted: ${recs[i].score} > ${recs[i - 1].score}`);
      }
    });

    it('should include every entry with a reason and score', async () => {
      const spec = {
        ram: { total: 65536 },
        cpu: { cores: 16 },
        gpu: { model: 'NVIDIA', vram: 8192 },
        tools: { docker: true, podman: true, firejail: true, vmware: true },
        os: { platform: 'linux' },
        hasVisionModel: false,
      };
      const recs = await SystemDetector.recommend(spec);
      assert.ok(recs.length >= 4);
      for (const r of recs) {
        assert.ok(typeof r.type === 'string');
        assert.ok(typeof r.reason === 'string');
        assert.ok(r.reason.length > 0);
        assert.ok(typeof r.score === 'number');
      }
    });
  });
});

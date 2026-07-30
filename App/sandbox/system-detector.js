const os = require('os');
const { execSync } = require('child_process');

const BACKENDS = [
  { type: 'none', label: 'Keine Sandbox', minRam: 0, minCores: 0, minVram: 0, requiresVision: false },
  { type: 'firejail', label: 'Firejail', minRam: 0, minCores: 0, minVram: 0, requiresVision: false },
  { type: 'docker', label: 'Docker', minRam: 8192, minCores: 2, minVram: 0, requiresVision: false },
  { type: 'podman', label: 'Podman', minRam: 8192, minCores: 2, minVram: 0, requiresVision: false },
  { type: 'vmware', label: 'VMware', minRam: 16384, minCores: 4, minVram: 4096, requiresVision: false },
];

class SystemDetector {
  static async detect() {
    const cpus = os.cpus();
    const totalRam = os.totalmem();
    const platform = os.platform();
    const distro = platform === 'linux'
      ? (execSync('lsb_release -ds 2>/dev/null || cat /etc/os-release 2>/dev/null | grep "^PRETTY_NAME" | cut -d= -f2', { encoding: 'utf-8' }).trim().replace(/"/g, '') || 'unknown')
      : platform;

    const gpuInfo = await SystemDetector._detectGpu();
    const hasDocker = await SystemDetector._checkBinary('docker');
    const hasPodman = await SystemDetector._checkBinary('podman');
    const hasFirejail = await SystemDetector._checkBinary('firejail');
    const hasVmware = await SystemDetector._checkBinary('vmrun');

    return {
      cpu: {
        model: cpus[0]?.model || 'unknown',
        cores: cpus.length,
      },
      ram: {
        total: Math.floor(totalRam / 1024 / 1024), // MB
      },
      gpu: gpuInfo,
      os: { platform, distro },
      tools: {
        docker: hasDocker,
        podman: hasPodman,
        firejail: hasFirejail,
        vmware: hasVmware,
      }
    };
  }

  static async _detectGpu() {
    try {
      const out = execSync(
        'lspci 2>/dev/null | grep -i "vga\\|3d\\|display" | head -1 || '
        + 'system_profiler SPDisplaysDataType 2>/dev/null | grep "Chipset Model" | head -1 || '
        + 'wmic path win32_VideoController get name 2>/dev/null | findstr /v "Name" | head -1',
        { encoding: 'utf-8', timeout: 5000 }
      );
      const model = out.trim() || 'unknown';
      let vram = 0;
      try {
        const nvidiaOut = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
        vram = parseInt(nvidiaOut.trim()) || 0;
      } catch {}
      return { model, vram };
    } catch {
      return { model: 'unknown', vram: 0 };
    }
  }

  static async _checkBinary(name) {
    try {
      execSync(`which ${name} 2>/dev/null || where ${name} 2>nul`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static async recommend(spec) {
    const { ram, cpu, gpu, tools, hasVisionModel } = spec;
    const recommendations = [];

    recommendations.push({ type: 'none', reason: 'Immer verfügbar (Fallback)', score: 1 });

    if (tools.firejail && spec.os.platform === 'linux') {
      recommendations.push({ type: 'firejail', reason: 'Schnell, geringer RAM-Verbrauch', score: ram.total < 8192 ? 5 : 3 });
    }

    if (tools.docker && ram.total >= 8192 && cpu.cores >= 2) {
      const score = hasVisionModel ? (ram.total >= 16384 ? 4 : 2) : (ram.total >= 16384 ? 5 : 4);
      recommendations.push({ type: 'docker', reason: 'Gute Isolation, weit verbreitet', score });
    }

    if (tools.podman && ram.total >= 8192 && cpu.cores >= 2) {
      const score = hasVisionModel ? (ram.total >= 16384 ? 4 : 2) : (ram.total >= 16384 ? 5 : 4);
      recommendations.push({ type: 'podman', reason: 'Daemonlos, rootless, Docker-kompatibel', score: score - 0.5 });
    }

    if (tools.vmware && ram.total >= 16384 && cpu.cores >= 4) {
      if (!hasVisionModel || gpu.vram >= 4096) {
        const score = hasVisionModel ? (ram.total >= 32768 ? 5 : 3) : (ram.total >= 32768 ? 4 : 2);
        recommendations.push({ type: 'vmware', reason: 'Vollständige Isolation, Vision-fähig', score });
      } else {
        recommendations.push({ type: 'vmware', reason: 'VM möglich, aber VRAM für Vision knapp', score: 1 });
      }
    }

    recommendations.sort((a, b) => b.score - a.score);
    return recommendations;
  }
}

module.exports = { SystemDetector };

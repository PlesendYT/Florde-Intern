const TEMPLATES = {
  ubuntu: { label: 'Ubuntu Server', type: 'headless', image: 'ubuntu-24.04-server.iso', url: 'https://releases.ubuntu.com/noble/ubuntu-24.04.2-server-amd64.iso', ram: 2048, cpu: 2, disk: 20, username: 'ubuntu', password: 'florde' },
  ubuntuDesktop: { label: 'Ubuntu Desktop', type: 'desktop', image: 'ubuntu-24.04-desktop.iso', url: 'https://releases.ubuntu.com/noble/ubuntu-24.04.2-desktop-amd64.iso', ram: 4096, cpu: 2, disk: 30, username: 'ubuntu', password: 'florde' },
  linuxmint: { label: 'Linux Mint', type: 'desktop', image: 'linuxmint-22.iso', url: 'https://mirrors.kernel.org/linuxmint/stable/22/linuxmint-22-cinnamon-64bit.iso', ram: 4096, cpu: 2, disk: 30, username: 'mint', password: 'florde' },
  debian: { label: 'Debian', type: 'headless', image: 'debian-12.iso', url: 'https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-12.5.0-amd64-netinst.iso', ram: 2048, cpu: 2, disk: 20, username: 'debian', password: 'florde' },
  fedora: { label: 'Fedora Workstation', type: 'desktop', image: 'fedora-40-workstation.iso', url: 'https://download.fedoraproject.org/pub/fedora/linux/releases/40/Workstation/x86_64/iso/Fedora-Workstation-Live-x86_64-40-1.14.iso', ram: 4096, cpu: 2, disk: 30, username: 'fedora', password: 'florde' },
  arch: { label: 'Arch Linux', type: 'desktop', image: 'archlinux-latest.iso', url: 'https://geo.mirror.pkgbuild.com/iso/latest/archlinux-x86_64.iso', ram: 2048, cpu: 2, disk: 25, username: 'arch', password: 'florde' },
  tiny10: { label: 'Tiny10', type: 'headless', image: 'tiny10-23h2.iso', url: '', ram: 1024, cpu: 1, disk: 10, username: 'admin', password: 'florde' },
  windowsServer: { label: 'Windows Server', type: 'headless', image: 'windows-server-2022.iso', url: '', ram: 4096, cpu: 4, disk: 40, username: 'Administrator', password: 'florde' },
  windows10: { label: 'Windows 10', type: 'headless', image: 'windows-10.iso', url: '', ram: 2048, cpu: 2, disk: 30, username: 'nvda', password: 'florde' },
  windows11Light: { label: 'Windows 11 Light', type: 'headless', image: 'windows-11-light.iso', url: '', ram: 4096, cpu: 4, disk: 40, username: 'nvda', password: 'florde' },
  custom: { label: 'Custom', type: 'desktop', image: null, url: '', ram: 4096, cpu: 2, disk: 40, username: null, password: null },
};

function getTemplate(key) {
  if (!TEMPLATES[key]) throw new Error('Unknown template: ' + key);
  return { ...TEMPLATES[key] };
}

function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, type: t.type }));
}

module.exports = { TEMPLATES, getTemplate, listTemplates };

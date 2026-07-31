const TEMPLATES = {
  ubuntu: { label: 'Ubuntu Server', type: 'headless', image: 'ubuntu-24.04-server.iso', ram: 2048, cpu: 2, disk: 20, username: 'ubuntu', password: 'florde' },
  ubuntuDesktop: { label: 'Ubuntu Desktop', type: 'desktop', image: 'ubuntu-24.04-desktop.iso', ram: 4096, cpu: 2, disk: 30, username: 'ubuntu', password: 'florde' },
  debian: { label: 'Debian', type: 'headless', image: 'debian-12.iso', ram: 2048, cpu: 2, disk: 20, username: 'debian', password: 'florde' },
  fedora: { label: 'Fedora Workstation', type: 'desktop', image: 'fedora-40-workstation.iso', ram: 4096, cpu: 2, disk: 30, username: 'fedora', password: 'florde' },
  arch: { label: 'Arch Linux', type: 'desktop', image: 'archlinux-latest.iso', ram: 2048, cpu: 2, disk: 25, username: 'arch', password: 'florde' },
  tiny10: { label: 'Tiny10', type: 'headless', image: 'tiny10-23h2.iso', ram: 1024, cpu: 1, disk: 10, username: 'admin', password: 'florde' },
  windowsServer: { label: 'Windows Server', type: 'headless', image: 'windows-server-2022.iso', ram: 4096, cpu: 4, disk: 40, username: 'Administrator', password: 'florde' },
  custom: { label: 'Custom', type: 'desktop', image: null, ram: 4096, cpu: 2, disk: 40, username: null, password: null },
};

function getTemplate(key) {
  if (!TEMPLATES[key]) throw new Error('Unknown template: ' + key);
  return { ...TEMPLATES[key] };
}

function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, type: t.type }));
}

module.exports = { TEMPLATES, getTemplate, listTemplates };

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

function showDownloadModal() {
  showModal('download-modal');
  const detected = detectOS();
  const el = document.getElementById('download-detected-os');
  if (detected) {
    el.textContent = 'We detected ' + getOSName(detected) + ' — the matching option is highlighted.';
    document.querySelectorAll('.download-option').forEach(o => o.classList.remove('recommended'));
    const opt = document.querySelector('.download-option[data-os="' + detected + '"]');
    if (opt) opt.classList.add('recommended');
  } else {
    el.textContent = 'Select your operating system:';
  }
}

document.querySelectorAll('.buy-btn, .btn-download-top, .btn-download').forEach(btn => {
  btn.addEventListener('click', (e) => { e.preventDefault(); showDownloadModal(); });
});

function detectOS() {
  const ua = navigator.userAgent;
  if (ua.includes('Windows NT')) return 'windows';
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'macos';
  if (ua.includes('Linux')) return 'linux';
  return null;
}
function getOSName(os) {
  return { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[os] || 'your system';
}

document.getElementById('btn-close-download').addEventListener('click', () => hideModal('download-modal'));

document.querySelectorAll('.download-option').forEach(opt => {
  opt.addEventListener('click', () => {
    const os = opt.getAttribute('data-os');
    const arch = navigator.userAgent.includes('arm64') || navigator.userAgent.includes('aarch64') ? 'arm64' : 'x64';
    const files = {
      windows: 'App_Download/Florde-Setup-1.0.0.exe',
      macos: arch === 'arm64' ? 'App_Download/Florde-1.0.0-arm64.dmg' : 'App_Download/Florde-1.0.0-x64.dmg',
      linux: arch === 'arm64' ? 'App_Download/Florde-1.0.0-arm64.deb' : 'App_Download/Florde-1.0.0-amd64.deb'
    };
    if (files[os]) window.location.href = files[os];
  });
});

// Auth Modal
function showModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function hideModal(id) {
  document.getElementById(id).classList.add('hidden');
}

document.getElementById('btn-signin').addEventListener('click', (e) => {
  e.preventDefault();
  showModal('signin-modal');
});

document.getElementById('btn-signup').addEventListener('click', (e) => {
  e.preventDefault();
  showModal('signup-modal');
});

document.getElementById('btn-close-signin').addEventListener('click', () => hideModal('signin-modal'));
document.getElementById('btn-close-signup').addEventListener('click', () => hideModal('signup-modal'));

document.getElementById('switch-to-signup').addEventListener('click', (e) => {
  e.preventDefault();
  hideModal('signin-modal');
  showModal('signup-modal');
});

document.getElementById('switch-to-signin').addEventListener('click', (e) => {
  e.preventDefault();
  hideModal('signup-modal');
  showModal('signin-modal');
});

// Close modals on backdrop click
document.querySelectorAll('.auth-modal').forEach(m => {
  m.addEventListener('click', (e) => {
    if (e.target === m) m.classList.add('hidden');
  });
});

const showAuthInfo = (e, mode) => {
  e.preventDefault();
  hideModal(mode === 'signin' ? 'signin-modal' : 'signup-modal');
  alert(`Cloud accounts are coming soon! For now, download the app and use it with your own API keys.`);
};
document.getElementById('signin-form').addEventListener('submit', (e) => showAuthInfo(e, 'signin'));
document.getElementById('signup-form').addEventListener('submit', (e) => showAuthInfo(e, 'signup'));

// Pricing toggle
document.getElementById('pricing-period-toggle')?.addEventListener('change', function() {
  const period = this.checked ? 'yearly' : 'monthly';
  document.querySelectorAll('.toggle-label').forEach(l => l.classList.toggle('active', l.dataset.period === period));
  document.querySelectorAll('.price-amount').forEach(el => {
    el.textContent = el.dataset[period];
  });
  document.querySelectorAll('.price-period').forEach(el => {
    if (el.dataset[period]) el.textContent = el.dataset[period];
  });
});

// FAQ collapsible
document.querySelectorAll('.faq-question').forEach(q => {
  q.addEventListener('click', () => {
    const answer = q.nextElementSibling;
    const isOpen = answer.classList.contains('open');
    document.querySelectorAll('.faq-answer.open').forEach(a => { a.classList.remove('open'); a.previousElementSibling.classList.remove('open'); });
    if (!isOpen) { answer.classList.add('open'); q.classList.add('open'); }
  });
});

// Install tab switching
document.querySelectorAll('.install-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const os = tab.dataset.os;
    document.querySelectorAll('.install-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.install-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.install-content[data-os="' + os + '"]')?.classList.add('active');
  });
});

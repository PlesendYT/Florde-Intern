document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

const downloadApp = () => { window.location.href = 'App_Download/Florde-Setup.exe'; };
document.querySelectorAll('.buy-btn, .btn-download-top, .btn-download').forEach(btn => {
  btn.addEventListener('click', (e) => { e.preventDefault(); downloadApp(); });
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

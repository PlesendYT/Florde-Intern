const translations = {
  en: {
    'hero_title': 'Build Software with AI',
    'hero_sub': 'An open-source, AI-powered development environment that works with your local models.',
    'features_title': 'Core Features',
    'download_title': 'Download Florde',
    'download_sub': 'Available for Windows, macOS, and Linux.',
    'docs_title': 'Documentation',
    'showcase_title': 'What You Can Build',
    'showcase_sub': 'Florde helps you build anything — from web apps to CLI tools.',
    'nav_home': 'Home',
    'nav_docs': 'Docs',
    'nav_showcase': 'Showcase',
    'nav_comparison': 'Comparison',
    'nav_download': 'Download',
  },
  de: {
    'hero_title': 'Software mit KI bauen',
    'hero_sub': 'Eine Open-Source, KI-gestützte Entwicklungsumgebung, die mit Ihren lokalen Modellen arbeitet.',
    'features_title': 'Kernfunktionen',
    'download_title': 'Florde herunterladen',
    'download_sub': 'Verfügbar für Windows, macOS und Linux.',
    'docs_title': 'Dokumentation',
    'showcase_title': 'Was Sie bauen können',
    'showcase_sub': 'Florde hilft Ihnen, alles zu bauen — von Web-Apps bis zu CLI-Tools.',
    'nav_home': 'Startseite',
    'nav_docs': 'Dokumentation',
    'nav_showcase': 'Beispiele',
    'nav_comparison': 'Vergleich',
    'nav_download': 'Herunterladen',
  }
};

let currentLang = localStorage.getItem('florde-lang') || 'en';

function applyLanguage() {
  const t = translations[currentLang];
  document.querySelectorAll('[lang-key]').forEach(el => {
    const key = el.getAttribute('lang-key');
    if (t[key]) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = t[key];
      else el.textContent = t[key];
    }
  });
  document.documentElement.lang = currentLang;
}

document.addEventListener('DOMContentLoaded', () => {
  applyLanguage();
  const toggle = document.getElementById('lang-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      currentLang = currentLang === 'en' ? 'de' : 'en';
      localStorage.setItem('florde-lang', currentLang);
      applyLanguage();
      toggle.title = currentLang === 'en' ? 'Switch to Deutsch' : 'Switch to English';
    });
  }
});

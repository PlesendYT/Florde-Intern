const { ipcRenderer } = require('electron');

// Inject browser navigation bar
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.createElement('div');
  nav.id = 'florde-browser-nav';
  nav.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;align-items:center;gap:4px;padding:4px 6px;background:#1a1a2e;border-bottom:1px solid rgba(255,255,255,0.1);height:36px;box-sizing:border-box;';

  const btnStyle = 'background:none;border:none;color:#ccc;cursor:pointer;font-size:16px;padding:2px 6px;border-radius:4px;line-height:1;';
  const btnHover = 'e=>e.target.style.background="rgba(255,255,255,0.1)"';
  const btnLeave = 'e=>e.target.style.background="none"';

  const backBtn = document.createElement('button');
  backBtn.innerHTML = '&#9664;';
  backBtn.title = 'Back';
  backBtn.style.cssText = btnStyle;
  backBtn.onmouseenter = () => backBtn.style.background = 'rgba(255,255,255,0.1)';
  backBtn.onmouseleave = () => backBtn.style.background = 'none';
  backBtn.onclick = () => ipcRenderer.send('browser-nav-back');

  const fwdBtn = document.createElement('button');
  fwdBtn.innerHTML = '&#9654;';
  fwdBtn.title = 'Forward';
  fwdBtn.style.cssText = btnStyle;
  fwdBtn.onmouseenter = () => fwdBtn.style.background = 'rgba(255,255,255,0.1)';
  fwdBtn.onmouseleave = () => fwdBtn.style.background = 'none';
  fwdBtn.onclick = () => ipcRenderer.send('browser-nav-forward');

  const reloadBtn = document.createElement('button');
  reloadBtn.innerHTML = '&#8635;';
  reloadBtn.title = 'Reload';
  reloadBtn.style.cssText = btnStyle;
  reloadBtn.onmouseenter = () => reloadBtn.style.background = 'rgba(255,255,255,0.1)';
  reloadBtn.onmouseleave = () => reloadBtn.style.background = 'none';
  reloadBtn.onclick = () => ipcRenderer.send('browser-nav-reload');

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.id = 'florde-browser-url';
  urlInput.style.cssText = 'flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:2px 8px;border-radius:4px;font-size:13px;height:24px;outline:none;';
  urlInput.placeholder = 'Enter URL...';
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      let url = urlInput.value.trim();
      if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      if (url) ipcRenderer.send('browser-nav-url', url);
    }
  });

  const openInChrome = document.createElement('button');
  openInChrome.innerHTML = '&#8599;';
  openInChrome.title = 'Open in system browser';
  openInChrome.style.cssText = btnStyle;
  openInChrome.onmouseenter = () => openInChrome.style.background = 'rgba(255,255,255,0.1)';
  openInChrome.onmouseleave = () => openInChrome.style.background = 'none';
  openInChrome.onclick = () => ipcRenderer.send('browser-nav-external', urlInput.value);

  nav.appendChild(backBtn);
  nav.appendChild(fwdBtn);
  nav.appendChild(reloadBtn);
  nav.appendChild(urlInput);
  nav.appendChild(openInChrome);
  document.body.appendChild(nav);

  // Push page content down so it's not hidden behind nav
  document.body.style.paddingTop = '44px';
  document.body.style.marginTop = '0';

  // Keep URL bar in sync with page navigation
  const updateUrl = () => { urlInput.value = window.location.href; };
  updateUrl();
  window.addEventListener('popstate', updateUrl);
  window.addEventListener('hashchange', updateUrl);

  // Override pushState/replaceState to track URL changes
  const origPushState = history.pushState;
  history.pushState = function() { origPushState.apply(this, arguments); updateUrl(); };
  const origReplaceState = history.replaceState;
  history.replaceState = function() { origReplaceState.apply(this, arguments); updateUrl(); };
});

// Listen for URL updates from main process
ipcRenderer.on('browser-url-changed', (event, url) => {
  const input = document.getElementById('florde-browser-url');
  if (input) input.value = url;
  // Remove old active state
  document.querySelectorAll('#florde-browser-nav button').forEach(b => b.style.color = '#ccc');
});

const { ipcRenderer } = require('electron');

try {
  function injectNav() {
    if (!document.body) { requestAnimationFrame(injectNav); return; }

    const nav = document.createElement('div');
    nav.id = 'florde-browser-nav';
    nav.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;align-items:center;gap:4px;padding:4px 6px;background:#1a1a2e;border-bottom:1px solid rgba(255,255,255,0.1);height:36px;box-sizing:border-box;';

    function makeBtn(html, title, fn) {
      const b = document.createElement('button');
      b.innerHTML = html;
      b.title = title;
      b.style.cssText = 'background:none;border:none;color:#ccc;cursor:pointer;font-size:16px;padding:2px 6px;border-radius:4px;line-height:1;';
      b.onmouseenter = () => b.style.background = 'rgba(255,255,255,0.1)';
      b.onmouseleave = () => b.style.background = 'none';
      b.onclick = fn;
      return b;
    }

    const backBtn = makeBtn('&#9664;', 'Back', () => ipcRenderer.send('browser-nav-back'));
    const fwdBtn = makeBtn('&#9654;', 'Forward', () => ipcRenderer.send('browser-nav-forward'));
    const reloadBtn = makeBtn('&#8635;', 'Reload', () => ipcRenderer.send('browser-nav-reload'));

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.id = 'florde-browser-url';
    urlInput.style.cssText = 'flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;padding:2px 8px;border-radius:4px;font-size:13px;height:24px;outline:none;';
    urlInput.placeholder = 'Enter URL...';
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let url = urlInput.value.trim();
        if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) {
          url = 'https://' + url;
        }
        if (url) ipcRenderer.send('browser-nav-url', url);
      }
    });

    const externalBtn = makeBtn('&#8599;', 'Open in system browser', () => {
      const url = urlInput.value.trim();
      if (url) ipcRenderer.send('browser-nav-external', url);
    });

    nav.appendChild(backBtn);
    nav.appendChild(fwdBtn);
    nav.appendChild(reloadBtn);
    nav.appendChild(urlInput);
    nav.appendChild(externalBtn);
    document.body.appendChild(nav);
    document.body.style.paddingTop = '44px';
    document.body.style.marginTop = '0';

    const updateUrl = () => { urlInput.value = window.location.href; };
    updateUrl();
    window.addEventListener('popstate', updateUrl);
    window.addEventListener('hashchange', updateUrl);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectNav);
  } else {
    injectNav();
  }
} catch (e) {
  console.error('Florde browser nav error:', e);
}

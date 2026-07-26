// ---- Terminal typing animation (only runs on pages with #termBody) ----
const termEl = document.getElementById('termBody');
if (termEl) {
  const lines = [
    { html: '<span class="prompt">florde&gt;</span> Build me a REST API with auth' },
    { html: 'Reading project structure … <span class="path">src/</span>' },
    { html: 'Creating <span class="path">auth/middleware.ts</span>' },
    { html: 'Creating <span class="path">routes/users.ts</span>' },
    { html: 'Running: <span class="path">npm install jsonwebtoken</span>' },
    { html: '<span class="ok">&#10003;</span> Tests written (4 passed)' },
    { html: '<span class="ok">&#10003;</span> Health scan: no vulnerabilities found' },
    { html: '<span class="prompt">florde&gt;</span> Done. Should I commit?' },
  ];

  let li = 0, ci = 0, currentDiv = null;

  function typeStep(){
    if(li >= lines.length){
      setTimeout(()=>{ termEl.innerHTML=''; li=0; ci=0; typeStep(); }, 2200);
      return;
    }
    if(ci === 0){
      currentDiv = document.createElement('div');
      currentDiv.className = 'line';
      termEl.appendChild(currentDiv);
    }
    const full = lines[li].html;
    const plain = full.replace(/<[^>]*>/g,'').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&');
    if(ci <= plain.length){
      currentDiv.textContent = plain.slice(0, ci);
      ci += Math.max(1, Math.floor(Math.random()*2));
      setTimeout(typeStep, 14 + Math.random()*22);
    } else {
      currentDiv.innerHTML = full + (li === lines.length-1 ? ' <span class="cursor"></span>' : '');
      li++; ci = 0;
      setTimeout(typeStep, 420);
    }
  }
  typeStep();
}

// ---- Mobile hamburger menu ----
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.classList.toggle('open', open);
    navToggle.setAttribute('aria-expanded', open);
  });
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      navToggle.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// ---- Scroll reveal for cards/rows across all pages ----
const observer = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      e.target.style.opacity = 1;
      e.target.style.transform = 'translateY(0)';
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.fcard, .pgroup, .tool-row, .sec-badge, .dl-card').forEach(elx=>{
  elx.style.opacity = 0;
  elx.style.transform = 'translateY(14px)';
  elx.style.transition = 'opacity .5s ease, transform .5s ease';
  observer.observe(elx);
});

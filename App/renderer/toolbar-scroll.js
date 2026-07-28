document.addEventListener('DOMContentLoaded', () => {
  const center = document.getElementById('titlebar-center');
  const leftBtn = document.getElementById('toolbar-scroll-left');
  const rightBtn = document.getElementById('toolbar-scroll-right');
  if (!center) return;

  function updateScrollButtons() {
    const hasOverflow = center.scrollWidth > center.clientWidth;
    leftBtn.classList.toggle('visible', hasOverflow && center.scrollLeft > 0);
    rightBtn.classList.toggle('visible', hasOverflow && center.scrollLeft < center.scrollWidth - center.clientWidth - 2);
  }

  center.addEventListener('scroll', updateScrollButtons);
  window.addEventListener('resize', updateScrollButtons);
  leftBtn.addEventListener('click', () => { center.scrollBy({ left: -120, behavior: 'smooth' }); });
  rightBtn.addEventListener('click', () => { center.scrollBy({ left: 120, behavior: 'smooth' }); });
  setTimeout(updateScrollButtons, 100);
});

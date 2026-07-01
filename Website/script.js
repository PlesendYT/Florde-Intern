document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

document.querySelectorAll('.buy-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const plan = btn.dataset.plan;
    const prices = { starter: 19, pro: 49, founder: 199 };
    alert(`[Demo] You selected the ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan (\u20AC${prices[plan]}). Payment integration coming soon!`);
  });
});

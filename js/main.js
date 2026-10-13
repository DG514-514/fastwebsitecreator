(() => {
  const cfg = window.FWC_CONFIG || {};

  document.getElementById('year').textContent = new Date().getFullYear();
  document.querySelectorAll('.js-email').forEach((a) => {
    a.href = `mailto:${cfg.email}`;
    if (a.textContent === 'Email us') a.textContent = cfg.email;
  });

  // Mobile menu
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('nav-menu');
  toggle.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  // Project brief form
  const form = document.getElementById('start-form');
  const status = form.querySelector('.form-status');
  const labels = {
    name: 'Name', email: 'Email', business: 'Business', phone: 'Phone', concept: 'Idea',
    pages: 'Pages', assets: 'Sketches / images', inspiration: 'Websites they like',
    have: 'Already has', support: '$10/mo support',
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'form-status';
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const data = new FormData(form);
    if (data.get('_gotcha')) return; // bot trap

    const lines = Object.entries(labels).map(([key, label]) => {
      const value = data.getAll(key).filter(Boolean).join(', ');
      return `${label}: ${value || '—'}`;
    });
    const subject = `New website project: ${data.get('business')}`;
    const btn = form.querySelector('button[type=submit]');

    if (cfg.formEndpoint) {
      btn.disabled = true;
      status.textContent = 'Sending…';
      try {
        const body = Object.fromEntries(Object.keys(labels).map((k) => [k, data.getAll(k).join(', ')]));
        body._subject = subject;
        const res = await fetch(cfg.formEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        form.reset();
        status.classList.add('ok');
        status.textContent = "Thanks! Your brief is in — we'll reply within one business day with next steps.";
      } catch {
        status.classList.add('err');
        status.textContent = `Something went wrong. Please email us at ${cfg.email}.`;
      } finally {
        btn.disabled = false;
      }
      return;
    }

    window.location.href = `mailto:${cfg.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
    status.classList.add('ok');
    status.textContent = `Your email app should open with your brief ready to send. If not, email us at ${cfg.email}.`;
  });
})();

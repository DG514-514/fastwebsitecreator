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

  // File uploads
  const MAX_FILES = 10;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
  const ALLOWED = /\.(jpe?g|png|gif|webp|svg|heic|heif|pdf|docx?|pptx?|key|txt|rtf|ai|eps|psd|fig|sketch|zip)$/i;

  const form = document.getElementById('start-form');
  const status = form.querySelector('.form-status');
  const fileInput = document.getElementById('files');
  const dropzone = form.querySelector('.dropzone');
  const fileList = form.querySelector('.file-list');
  let files = [];
  let fileError = '';

  const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

  function renderFiles() {
    fileList.replaceChildren(...files.map((file, i) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'fname';
      name.textContent = file.name;
      const size = document.createElement('span');
      size.className = 'fsize';
      size.textContent = formatSize(file.size);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Remove ${file.name}`);
      remove.addEventListener('click', () => {
        files.splice(i, 1);
        fileError = '';
        renderFiles();
      });
      li.append(name, size, remove);
      return li;
    }));
    if (fileError) {
      const li = document.createElement('li');
      li.className = 'file-err';
      li.textContent = fileError;
      fileList.append(li);
    }
  }

  function addFiles(list) {
    const problems = [];
    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const file of list) {
      if (files.length >= MAX_FILES) { problems.push(`You can upload up to ${MAX_FILES} files.`); break; }
      if (!ALLOWED.test(file.name)) { problems.push(`${file.name} isn't a supported file type.`); continue; }
      if (file.size > MAX_FILE_BYTES) { problems.push(`${file.name} is over 10 MB — paste a link to it below instead.`); continue; }
      if (total + file.size > MAX_TOTAL_BYTES) { problems.push(`${file.name} would take you over 25 MB in total — paste a link to it below instead.`); continue; }
      if (files.some((f) => f.name === file.name && f.size === file.size)) continue;
      files.push(file);
      total += file.size;
    }
    fileError = problems.join(' ');
    renderFiles();
  }

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, () => dropzone.classList.remove('over')));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });

  // Project brief form
  const labels = {
    name: 'Name', email: 'Email', business: 'Business', phone: 'Phone', concept: 'Idea',
    pages: 'Pages', assetLinks: 'Links to files', inspiration: 'Websites they like',
    have: 'Already has', support: '$10/mo support',
  };

  function openEmailFallback(data, note) {
    const lines = Object.entries(labels).map(([key, label]) => `${label}: ${data.getAll(key).filter(Boolean).join(', ') || '—'}`);
    if (files.length) lines.push('', `Files to attach: ${files.map((f) => f.name).join(', ')}`);
    window.location.href = `mailto:${cfg.email}?subject=${encodeURIComponent(`New website project: ${data.get('business')}`)}&body=${encodeURIComponent(lines.join('\n'))}`;
    status.classList.add('ok');
    status.textContent = note;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'form-status';
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const data = new FormData(form);
    data.delete('files');
    if (data.get('_gotcha')) return; // bot trap

    if (!cfg.apiUrl) {
      openEmailFallback(data, `Your email app should open with your brief ready to send${files.length ? ' — please attach your files to the email' : ''}. If not, email us at ${cfg.email}.`);
      return;
    }

    files.forEach((file) => data.append('files', file, file.name));
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    status.textContent = files.length ? 'Uploading your files and sending your brief…' : 'Sending your brief…';
    try {
      const res = await fetch(cfg.apiUrl, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
      const result = await res.json().catch(() => ({}));
      if (res.status === 400 || res.status === 429) {
        status.classList.add('err');
        status.textContent = result.error || 'Please check your brief and try again.';
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      files = [];
      fileError = '';
      renderFiles();
      status.classList.add('ok');
      status.textContent = "Thanks! Your brief is in — we'll reply within one business day with next steps.";
    } catch {
      data.delete('files');
      openEmailFallback(data, `We couldn't reach our upload service, so your email app should open with your brief${files.length ? ' — please attach your files to the email' : ''}. Or email us at ${cfg.email}.`);
    } finally {
      btn.disabled = false;
    }
  });
})();

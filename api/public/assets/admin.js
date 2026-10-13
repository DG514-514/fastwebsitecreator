(() => {
  const app = document.getElementById('app');
  const STATUS_LABELS = {
    new: 'New',
    reviewing: 'Reviewing',
    awaiting_payment: 'Awaiting payment',
    building: 'Building',
    draft_sent: 'Draft sent',
    live: 'Live',
    closed: 'Closed',
  };
  const STATUSES = Object.keys(STATUS_LABELS);

  // ── helpers ──
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = Boolean(value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  async function api(path, options = {}) {
    const res = await fetch(`/api/admin${path}`, {
      ...options,
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 401) {
      window.location.reload();
      throw new Error('Signed out');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  const toDate = (sql) => new Date(`${sql.replace(' ', 'T')}Z`);
  const fmtDate = (sql) => toDate(sql).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const fmtDateTime = (sql) => toDate(sql).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  function ago(sql) {
    const mins = Math.round((Date.now() - toDate(sql)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.round(hrs / 24);
    return days < 30 ? `${days} d ago` : fmtDate(sql);
  }
  const fmtSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
  const badge = (status) => el('span', { class: `badge s-${status}` }, STATUS_LABELS[status] || status);
  const linkify = (text) => String(text).split(/(https?:\/\/[^\s,]+)/g).map((part, i) => (
    i % 2 ? el('a', { href: part, target: '_blank', rel: 'noopener noreferrer' }, part) : part
  ));

  function toast(message, isError = false) {
    const node = el('div', { class: `toast${isError ? ' toast-err' : ''}`, role: 'status' }, message);
    document.body.append(node);
    setTimeout(() => node.remove(), 2600);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  const views = {};
  let current = { status: '', q: '', clientQ: '' };

  // ── Requests list ──
  views.requests = async () => {
    const [summary, list] = await Promise.all([
      api('/summary'),
      api(`/requests?status=${encodeURIComponent(current.status)}&q=${encodeURIComponent(current.q)}`),
    ]);
    const total = Object.values(summary.counts).reduce((a, b) => a + b, 0);
    const open = total - summary.counts.live - summary.counts.closed;

    const stats = el('div', { class: 'stats' },
      el('div', { class: 'stat' }, el('strong', {}, summary.counts.new), el('span', {}, 'New requests')),
      el('div', { class: 'stat' }, el('strong', {}, open), el('span', {}, 'Open projects')),
      el('div', { class: 'stat' }, el('strong', {}, summary.counts.live), el('span', {}, 'Live websites')),
      el('div', { class: 'stat' }, el('strong', {}, summary.support), el('span', {}, 'On $10/mo support')));

    const chip = (value, label, count) => el('button', {
      type: 'button',
      class: `chip${current.status === value ? ' active' : ''}`,
      onclick: () => { current.status = value; render(); },
    }, label, el('span', { class: 'chip-count' }, count));

    const search = el('input', {
      type: 'search', class: 'search', placeholder: 'Search by business, client, email or idea…', value: current.q,
      'aria-label': 'Search requests',
      oninput: debounce((e) => { current.q = e.target.value; render().then(() => {
        const box = app.querySelector('.search'); box.focus(); box.setSelectionRange(box.value.length, box.value.length);
      }); }, 250),
    });

    const rows = list.requests.map((r) => el('tr', { class: r.status === 'new' ? 'is-new' : null, onclick: () => { location.hash = `#/requests/${r.id}`; } },
      el('td', {}, el('a', { href: `#/requests/${r.id}`, class: 'row-link' }, r.business), el('small', {}, `#${r.id}`)),
      el('td', {}, r.client_name, el('small', {}, r.client_email)),
      el('td', {}, badge(r.status)),
      el('td', { class: 'num' }, r.file_count ? `📎 ${r.file_count}` : '—'),
      el('td', {}, r.support ? '✓' : ''),
      el('td', { title: fmtDateTime(r.created_at) }, ago(r.created_at))));

    app.replaceChildren(
      el('div', { class: 'page-head' }, el('h1', {}, 'Project requests')),
      stats,
      el('div', { class: 'toolbar' },
        el('div', { class: 'chips' }, chip('', 'All', total), STATUSES.map((s) => chip(s, STATUS_LABELS[s], summary.counts[s]))),
        search),
      rows.length
        ? el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, ['Business', 'Client', 'Status', 'Files', 'Support', 'Received'].map((h) => el('th', {}, h)))),
          el('tbody', {}, rows)))
        : el('div', { class: 'empty' }, total ? 'No requests match your filters.' : 'No project requests yet. They\'ll appear here as soon as someone sends a brief from your website.'));
  };

  // ── Request detail ──
  views.request = async (id) => {
    const { request, client, files, otherRequests } = await api(`/requests/${id}`);
    const field = (label, value) => (value ? el('div', { class: 'field' }, el('dt', {}, label), el('dd', {}, linkify(value))) : null);

    const status = el('select', { 'aria-label': 'Status' }, STATUSES.map((s) => el('option', { value: s }, STATUS_LABELS[s])));
    status.value = request.status;
    status.addEventListener('change', async () => {
      try {
        await api(`/requests/${id}`, { method: 'PATCH', body: { status: status.value } });
        toast(`Status set to ${STATUS_LABELS[status.value]}`);
        statusBadge.replaceWith(statusBadge = badge(status.value));
      } catch (err) { toast(err.message, true); }
    });
    let statusBadge = badge(request.status);

    const notes = el('textarea', { rows: 6, placeholder: 'Private notes: calls, decisions, logins received, payment details…' });
    notes.value = request.notes;
    const saveNotes = el('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
      try {
        await api(`/requests/${id}`, { method: 'PATCH', body: { notes: notes.value } });
        toast('Notes saved');
      } catch (err) { toast(err.message, true); }
    } }, 'Save notes');

    const fileCards = files.map((f) => el('a', { class: 'file-card', href: `/admin/files/${f.id}`, title: `Download ${f.original_name}` },
      f.previewable
        ? el('img', { src: `/admin/files/${f.id}?inline=1`, alt: '', loading: 'lazy' })
        : el('span', { class: 'file-ext' }, (f.original_name.split('.').pop() || 'file').toUpperCase()),
      el('span', { class: 'file-name' }, f.original_name),
      el('small', {}, fmtSize(f.size))));

    const del = el('button', { class: 'link-btn danger', type: 'button', onclick: async () => {
      if (!confirm(`Delete request #${id} from ${client.name} and all its files? This can't be undone.`)) return;
      try {
        await api(`/requests/${id}`, { method: 'DELETE' });
        toast('Request deleted');
        location.hash = '#/requests';
      } catch (err) { toast(err.message, true); }
    } }, 'Delete request');

    app.replaceChildren(
      el('a', { class: 'back', href: '#/requests' }, '← All requests'),
      el('div', { class: 'page-head' },
        el('div', {}, el('h1', {}, request.business), el('p', { class: 'muted' }, `Request #${request.id} · received ${fmtDateTime(request.created_at)}`)),
        statusBadge),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'col-main' },
          el('section', { class: 'card' }, el('h2', {}, 'Brief'),
            el('dl', { class: 'fields' },
              field('Idea', request.concept),
              field('Pages', request.pages),
              field('Websites they like', request.inspiration),
              field('Links to large files', request.asset_links),
              field('Already has', request.have),
              field('$10/mo support', request.support ? 'Yes — wants support after launch' : 'No'))),
          el('section', { class: 'card' }, el('h2', {}, `Files (${files.length})`),
            files.length ? el('div', { class: 'files' }, fileCards) : el('p', { class: 'muted' }, 'No files uploaded.'))),
        el('aside', { class: 'col-side' },
          el('section', { class: 'card' }, el('h2', {}, 'Status'), status,
            el('h2', { class: 'mt' }, 'Notes'), notes, saveNotes),
          el('section', { class: 'card' }, el('h2', {}, 'Client'),
            el('p', { class: 'client-name' }, el('a', { href: `#/clients/${client.id}` }, client.name)),
            el('p', {}, el('a', { href: `mailto:${client.email}?subject=${encodeURIComponent(`Your website: ${request.business}`)}` }, client.email)),
            client.phone ? el('p', {}, el('a', { href: `tel:${client.phone}` }, client.phone)) : null,
            otherRequests.length ? el('div', { class: 'mt' }, el('h3', {}, 'Other requests'),
              el('ul', { class: 'mini-list' }, otherRequests.map((r) => el('li', {},
                el('a', { href: `#/requests/${r.id}` }, r.business), ' ', badge(r.status))))) : null),
          del)));
  };

  // ── Clients list ──
  views.clients = async () => {
    const { clients } = await api(`/clients?q=${encodeURIComponent(current.clientQ)}`);
    const search = el('input', {
      type: 'search', class: 'search', placeholder: 'Search by name, email or business…', value: current.clientQ,
      'aria-label': 'Search clients',
      oninput: debounce((e) => { current.clientQ = e.target.value; render().then(() => {
        const box = app.querySelector('.search'); box.focus(); box.setSelectionRange(box.value.length, box.value.length);
      }); }, 250),
    });
    const rows = clients.map((c) => el('tr', { onclick: () => { location.hash = `#/clients/${c.id}`; } },
      el('td', {}, el('a', { href: `#/clients/${c.id}`, class: 'row-link' }, c.name), el('small', {}, c.email)),
      el('td', {}, c.business || '—'),
      el('td', { class: 'num' }, c.request_count),
      el('td', {}, c.latest_status ? badge(c.latest_status) : '—'),
      el('td', {}, c.support ? '✓' : ''),
      el('td', {}, c.last_request_at ? ago(c.last_request_at) : '—')));

    app.replaceChildren(
      el('div', { class: 'page-head' }, el('h1', {}, 'Clients'), el('span', { class: 'muted' }, `${clients.length} client${clients.length === 1 ? '' : 's'}`)),
      el('div', { class: 'toolbar' }, search),
      rows.length
        ? el('div', { class: 'table-wrap' }, el('table', {},
          el('thead', {}, el('tr', {}, ['Client', 'Business', 'Requests', 'Latest status', 'Support', 'Last request'].map((h) => el('th', {}, h)))),
          el('tbody', {}, rows)))
        : el('div', { class: 'empty' }, current.clientQ ? 'No clients match your search.' : 'No clients yet. Each new email address that sends a brief becomes a client.'));
  };

  // ── Client detail ──
  views.client = async (id) => {
    const { client, requests } = await api(`/clients/${id}`);
    const input = (name, label, type = 'text') => el('label', {}, label, el('input', { name, type, value: client[name] || '' }));
    const form = el('form', { class: 'card stack', onsubmit: async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api(`/clients/${id}`, { method: 'PATCH', body: {
          name: f.name.value, business: f.business.value, phone: f.phone.value, support: f.support.checked, notes: f.notes.value,
        } });
        toast('Client saved');
      } catch (err) { toast(err.message, true); }
    } },
    el('h2', {}, 'Details'),
    input('name', 'Name'),
    el('label', {}, 'Email', el('input', { type: 'email', value: client.email, disabled: true })),
    input('business', 'Business'),
    input('phone', 'Phone', 'tel'),
    el('label', { class: 'chk' }, el('input', { type: 'checkbox', name: 'support', checked: client.support }), 'On $10/month support plan'),
    el('label', {}, 'Notes', el('textarea', { name: 'notes', rows: 5, placeholder: 'Anything to remember about this client…', value: client.notes })),
    el('button', { class: 'btn btn-sm', type: 'submit' }, 'Save client'));

    app.replaceChildren(
      el('a', { class: 'back', href: '#/clients' }, '← All clients'),
      el('div', { class: 'page-head' },
        el('div', {}, el('h1', {}, client.name), el('p', { class: 'muted' }, `Client since ${fmtDate(client.created_at)}`)),
        el('a', { class: 'btn btn-sm btn-ghost', href: `mailto:${client.email}` }, 'Email client')),
      el('div', { class: 'detail-grid' },
        el('div', { class: 'col-main' },
          el('section', { class: 'card' }, el('h2', {}, `Projects (${requests.length})`),
            requests.length
              ? el('div', { class: 'table-wrap flat' }, el('table', {},
                el('thead', {}, el('tr', {}, ['Project', 'Status', 'Files', 'Received'].map((h) => el('th', {}, h)))),
                el('tbody', {}, requests.map((r) => el('tr', { onclick: () => { location.hash = `#/requests/${r.id}`; } },
                  el('td', {}, el('a', { href: `#/requests/${r.id}`, class: 'row-link' }, r.business), el('small', {}, `#${r.id}`)),
                  el('td', {}, badge(r.status)),
                  el('td', { class: 'num' }, r.file_count ? `📎 ${r.file_count}` : '—'),
                  el('td', { title: fmtDateTime(r.created_at) }, fmtDate(r.created_at)))))))
              : el('p', { class: 'muted' }, 'No projects.'))),
        el('aside', { class: 'col-side' }, form)));
  };

  // ── Router ──
  async function render() {
    const [, section, id] = (location.hash || '#/requests').split('/');
    const tab = section === 'clients' ? 'clients' : 'requests';
    document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    try {
      if (tab === 'requests') await (id ? views.request(id) : views.requests());
      else await (id ? views.client(id) : views.clients());
      document.title = `${tab === 'clients' ? 'Clients' : 'Project requests'} | FastWebsiteCreator Admin`;
    } catch (err) {
      if (err.message !== 'Signed out') app.replaceChildren(el('div', { class: 'empty' }, err.message, ' ', el('a', { href: '#/requests' }, 'Back to requests')));
    }
  }

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  document.getElementById('logout').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.reload();
  });
  render();
})();

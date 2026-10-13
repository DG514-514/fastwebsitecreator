'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('./server');
const { openDb } = require('./db');

const ORIGIN = 'https://fastwebsitecreator.com';

async function withServer(fn, { send = async () => {}, env = {} } = {}) {
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fwc-'));
  const fullEnv = {
    RESEND_API_KEY: 'test', NOTIFY_EMAIL: 'owner@example.com', ALLOWED_ORIGINS: ORIGIN,
    ADMIN_EMAIL: 'Owner@Example.com', ADMIN_PASSWORD: 'correct horse', UPLOAD_DIR: uploadDir, ...env,
  };
  const server = createApp(fullEnv, { send, db: openDb(':memory:') }).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`, uploadDir);
  } finally {
    server.close();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
}

function brief(extra = {}) {
  const form = new FormData();
  const fields = { name: 'Sam', email: 'Sam@Example.com', business: 'Sam Bakery', concept: 'A bakery site', ...extra };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

const postBrief = (url, form, headers = { Origin: ORIGIN }) => fetch(`${url}/api/brief`, { method: 'POST', body: form, headers });

async function login(url, email = 'owner@example.com', password = 'correct horse') {
  const res = await fetch(`${url}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  return { res, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

const adminApi = (url, cookie, p, opts = {}) => fetch(`${url}/api/admin${p}`, {
  ...opts,
  headers: { Cookie: cookie, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
  body: opts.body ? JSON.stringify(opts.body) : undefined,
});

test('saves the brief and files, and emails it with files attached', async () => {
  const sent = [];
  await withServer(async (url, uploadDir) => {
    const form = brief({ have: 'Domain' });
    form.append('have', 'Hosting');
    form.append('files', new Blob(['sketch']), 'sketch.png');
    form.append('files', new Blob(['%PDF']), 'brief.pdf');
    const res = await postBrief(url, form);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), ORIGIN);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(fs.readdirSync(path.join(uploadDir, '1')).length, 2);
  }, { send: async (msg) => sent.push(msg), env: { ADMIN_URL: 'https://admin.fastwebsitecreator.com' } });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'owner@example.com');
  assert.strictEqual(sent[0].replyTo, 'sam@example.com');
  assert.deepStrictEqual(sent[0].files.map((f) => f.originalname), ['sketch.png', 'brief.pdf']);
  assert.match(sent[0].email.text, /Already has: Domain, Hosting/);
  assert.match(sent[0].email.text, /admin\.fastwebsitecreator\.com\/admin#\/requests\/1/);
});

test('still saves the brief when email fails or is not configured', async () => {
  await withServer(async (url) => {
    assert.strictEqual((await postBrief(url, brief())).status, 200);
    const { cookie } = await login(url);
    const { requests } = await (await adminApi(url, cookie, '/requests')).json();
    assert.strictEqual(requests.length, 1);
  }, { send: async () => { throw new Error('Resend down'); } });
});

test('rejects bad briefs: unsupported files, missing fields, other websites, bots', async () => {
  await withServer(async (url) => {
    const withExe = brief();
    withExe.append('files', new Blob(['MZ']), 'virus.exe');
    const res = await postBrief(url, withExe);
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /virus\.exe/);
    assert.strictEqual((await postBrief(url, brief({ email: 'nope' }))).status, 400);
    assert.strictEqual((await postBrief(url, brief(), { Origin: 'https://evil.example' })).status, 403);
    assert.strictEqual((await postBrief(url, brief({ _gotcha: 'spam' }))).status, 200);
    const { cookie } = await login(url);
    assert.strictEqual((await (await adminApi(url, cookie, '/requests')).json()).requests.length, 0);
  }, { send: async () => assert.fail('should not send') });
});

test('dashboard requires the owner login', async () => {
  await withServer(async (url) => {
    assert.strictEqual((await fetch(`${url}/api/admin/requests`)).status, 401);
    assert.match(await (await fetch(`${url}/admin`)).text(), /Sign in/);
    assert.strictEqual((await login(url, 'owner@example.com', 'wrong')).res.status, 401);
    assert.strictEqual((await fetch(`${url}/admin/files/1`)).status, 401);
    const { res, cookie } = await login(url);
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(res.headers.get('set-cookie'), /SameSite=Strict/i);
    assert.match(await (await fetch(`${url}/admin`, { headers: { Cookie: cookie } })).text(), /Project requests/);
    await fetch(`${url}/api/admin/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.strictEqual((await adminApi(url, cookie, '/requests')).status, 401);
  });
});

test('dashboard is off until ADMIN_EMAIL and ADMIN_PASSWORD are set', async () => {
  await withServer(async (url) => {
    assert.strictEqual((await login(url)).res.status, 503);
  }, { env: { ADMIN_PASSWORD: '' } });
});

test('groups requests by client and lets the owner organize them', async () => {
  await withServer(async (url) => {
    const first = brief({ support: 'Yes' });
    first.append('files', new Blob(['png']), 'logo.png');
    await postBrief(url, first);
    await postBrief(url, brief({ email: 'sam@example.com', business: 'Sam Catering', concept: 'Catering site' }));
    await postBrief(url, brief({ name: 'Alex', email: 'alex@example.com', business: 'Alex Fitness', concept: 'Gym' }));
    const { cookie } = await login(url);

    const { clients } = await (await adminApi(url, cookie, '/clients')).json();
    assert.strictEqual(clients.length, 2);
    const sam = clients.find((c) => c.email === 'sam@example.com');
    assert.strictEqual(sam.request_count, 2);
    assert.strictEqual(sam.support, 1);

    const detail = await (await adminApi(url, cookie, `/clients/${sam.id}`)).json();
    assert.deepStrictEqual(detail.requests.map((r) => r.business).sort(), ['Sam Bakery', 'Sam Catering']);

    const bakery = detail.requests.find((r) => r.business === 'Sam Bakery');
    let res = await adminApi(url, cookie, `/requests/${bakery.id}`, { method: 'PATCH', body: { status: 'awaiting_payment', notes: 'Sent $99 link' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await adminApi(url, cookie, `/requests/${bakery.id}`, { method: 'PATCH', body: { status: 'bogus' } })).status, 400);

    const filtered = await (await adminApi(url, cookie, '/requests?status=awaiting_payment')).json();
    assert.deepStrictEqual(filtered.requests.map((r) => r.business), ['Sam Bakery']);
    const searched = await (await adminApi(url, cookie, '/requests?q=gym')).json();
    assert.deepStrictEqual(searched.requests.map((r) => r.business), ['Alex Fitness']);

    const full = await (await adminApi(url, cookie, `/requests/${bakery.id}`)).json();
    assert.strictEqual(full.request.notes, 'Sent $99 link');
    assert.strictEqual(full.otherRequests.length, 1);
    assert.strictEqual(full.files[0].previewable, true);

    const file = await fetch(`${url}/admin/files/${full.files[0].id}`, { headers: { Cookie: cookie } });
    assert.strictEqual(file.status, 200);
    assert.match(file.headers.get('content-disposition'), /attachment; filename="?logo\.png"?/);
    assert.strictEqual(await file.text(), 'png');

    res = await adminApi(url, cookie, `/clients/${sam.id}`, { method: 'PATCH', body: { notes: 'Prefers calls', support: false } });
    assert.strictEqual((await res.json()).client.notes, 'Prefers calls');

    const summary = await (await adminApi(url, cookie, '/summary')).json();
    assert.strictEqual(summary.counts.new, 2);
    assert.strictEqual(summary.counts.awaiting_payment, 1);

    assert.strictEqual((await adminApi(url, cookie, `/requests/${bakery.id}`, { method: 'DELETE' })).status, 200);
    assert.strictEqual((await adminApi(url, cookie, `/requests/${bakery.id}`)).status, 404);
  });
});

test('admin writes must be JSON', async () => {
  await withServer(async (url) => {
    await postBrief(url, brief());
    const { cookie } = await login(url);
    const res = await fetch(`${url}/api/admin/requests/1`, {
      method: 'PATCH', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'status=live',
    });
    assert.strictEqual(res.status, 415);
  });
});

test('emails the client when their project status changes, and logs it', async () => {
  const sent = [];
  await withServer(async (url) => {
    await postBrief(url, brief({ name: 'Sam Lee' }));
    const { cookie } = await login(url);

    const preview = await (await adminApi(url, cookie, '/requests/1/client-email?status=awaiting_payment&message=Pay%20here%3A%20https%3A%2F%2Fpay.example')).json();
    assert.strictEqual(preview.to, 'sam@example.com');
    assert.match(preview.email.subject, /Sam Bakery/);
    assert.match(preview.email.text, /Hi Sam,/);
    assert.match(preview.email.text, /\$59/);
    assert.match(preview.email.text, /Pay here: https:\/\/pay\.example/);
    assert.strictEqual((await (await adminApi(url, cookie, '/requests/1/client-email?status=closed')).json()).email, null);

    let res = await (await adminApi(url, cookie, '/requests/1', { method: 'PATCH', body: { status: 'awaiting_payment', notifyClient: true, message: 'Pay here: https://pay.example' } })).json();
    assert.deepStrictEqual(res.clientEmail, { sent: true, to: 'sam@example.com' });

    // No email when not asked, when the status is unchanged, or for statuses without an email.
    res = await (await adminApi(url, cookie, '/requests/1', { method: 'PATCH', body: { status: 'building' } })).json();
    assert.strictEqual(res.clientEmail, null);
    res = await (await adminApi(url, cookie, '/requests/1', { method: 'PATCH', body: { status: 'building', notifyClient: true } })).json();
    assert.strictEqual(res.clientEmail, null);
    res = await (await adminApi(url, cookie, '/requests/1', { method: 'PATCH', body: { status: 'closed', notifyClient: true } })).json();
    assert.strictEqual(res.clientEmail, null);

    const detail = await (await adminApi(url, cookie, '/requests/1')).json();
    assert.strictEqual(detail.emails.length, 1);
    assert.strictEqual(detail.emails[0].status, 'awaiting_payment');
    assert.strictEqual(detail.emails[0].error, null);
  }, { send: async (msg) => sent.push(msg), env: { NOTIFY_EMAIL: 'build@fastwebsitecreator.com' } });

  const clientMails = sent.filter((m) => m.to === 'sam@example.com');
  assert.strictEqual(clientMails.length, 1);
  assert.strictEqual(clientMails[0].replyTo, 'build@fastwebsitecreator.com');
  assert.match(clientMails[0].email.html, /<a href="https:\/\/pay\.example"/);
});

test('saves the status and logs the failure when the client email cannot be sent', async () => {
  await withServer(async (url) => {
    await postBrief(url, brief());
    const { cookie } = await login(url);
    const res = await (await adminApi(url, cookie, '/requests/1', { method: 'PATCH', body: { status: 'live', notifyClient: true } })).json();
    assert.strictEqual(res.request.status, 'live');
    assert.strictEqual(res.clientEmail.sent, false);
    const detail = await (await adminApi(url, cookie, '/requests/1')).json();
    assert.match(detail.emails[0].error, /Resend/);
  }, { send: async (msg) => { if (msg.to === 'sam@example.com') throw new Error('rejected'); } });
});

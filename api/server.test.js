'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('./server');

const ENV = { RESEND_API_KEY: 'test', NOTIFY_EMAIL: 'owner@example.com', ALLOWED_ORIGINS: 'https://fastwebsitecreator.com' };

async function withServer(env, send, fn) {
  const server = createApp(env, send).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

function brief(extra = {}) {
  const form = new FormData();
  const fields = { name: 'Sam', email: 'sam@example.com', business: 'Sam Bakery', concept: 'A bakery site', ...extra };
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

test('emails the brief with uploaded files attached', async () => {
  const sent = [];
  await withServer(ENV, async (msg) => sent.push(msg), async (url) => {
    const form = brief({ have: 'Domain' });
    form.append('have', 'Hosting');
    form.append('files', new Blob(['sketch']), 'sketch.png');
    form.append('files', new Blob(['%PDF']), 'brief.pdf');
    const res = await fetch(`${url}/api/brief`, { method: 'POST', body: form, headers: { Origin: 'https://fastwebsitecreator.com' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), 'https://fastwebsitecreator.com');
  });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, 'owner@example.com');
  assert.strictEqual(sent[0].replyTo, 'sam@example.com');
  assert.deepStrictEqual(sent[0].files.map((f) => f.originalname), ['sketch.png', 'brief.pdf']);
  assert.match(sent[0].email.subject, /Sam Bakery/);
  assert.match(sent[0].email.text, /Already has: Domain, Hosting/);
});

test('rejects unsupported file types', async () => {
  await withServer(ENV, async () => assert.fail('should not send'), async (url) => {
    const form = brief();
    form.append('files', new Blob(['MZ']), 'virus.exe');
    const res = await fetch(`${url}/api/brief`, { method: 'POST', body: form });
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /virus\.exe/);
  });
});

test('rejects missing required fields', async () => {
  await withServer(ENV, async () => assert.fail('should not send'), async (url) => {
    const res = await fetch(`${url}/api/brief`, { method: 'POST', body: brief({ email: 'not-an-email' }) });
    assert.strictEqual(res.status, 400);
  });
});

test('rejects posts from other websites', async () => {
  await withServer(ENV, async () => assert.fail('should not send'), async (url) => {
    const res = await fetch(`${url}/api/brief`, { method: 'POST', body: brief(), headers: { Origin: 'https://evil.example' } });
    assert.strictEqual(res.status, 403);
  });
});

test('silently drops bot submissions', async () => {
  await withServer(ENV, async () => assert.fail('should not send'), async (url) => {
    const res = await fetch(`${url}/api/brief`, { method: 'POST', body: brief({ _gotcha: 'spam' }) });
    assert.strictEqual(res.status, 200);
  });
});

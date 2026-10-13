'use strict';

// Emails sent to a client when the owner moves their project to a new status.
// Edit the wording here. "New" and "Closed" have no email.

const BUILD_FEE = '$59';
const SUPPORT_FEE = '$10/month';

const TEMPLATES = {
  reviewing: {
    subject: (r) => `We're reviewing your website brief: ${r.business}`,
    body: (r, c) => [
      `Hi ${c.first},`,
      `Thanks for sending us your brief for ${r.business}. We've received everything and we're reviewing it now.`,
      `We'll be in touch shortly with any questions and the next steps.`,
    ],
  },
  awaiting_payment: {
    subject: (r) => `Ready to build ${r.business}: next step`,
    body: (r, c) => [
      `Hi ${c.first},`,
      `Good news: we've reviewed your brief for ${r.business} and we're ready to build your website.`,
      `To get started, please complete the ${BUILD_FEE} build fee. Your first draft will be ready within 2–3 business days of payment.`,
    ],
  },
  building: {
    subject: (r) => `We've started building ${r.business}`,
    body: (r, c) => [
      `Hi ${c.first},`,
      `Thanks, your payment is in and we've started building your website for ${r.business}.`,
      `You'll receive your first draft within 2–3 business days. If anything about your brief has changed, just reply to this email.`,
    ],
  },
  draft_sent: {
    subject: (r) => `Your first draft is ready: ${r.business}`,
    body: (r, c) => [
      `Hi ${c.first},`,
      `The first draft of your website for ${r.business} is ready for you to review.`,
      `Take a look and reply with any changes you'd like. Your package includes one round of revisions. Once you're happy, we'll connect your domain and take it live.`,
    ],
  },
  live: {
    subject: (r) => `${r.business} is live! 🎉`,
    body: (r, c) => [
      `Hi ${c.first},`,
      `Your website for ${r.business} is now live. Thank you for choosing FastWebsiteCreator!`,
      `If you shared any logins with us during setup, you can now change those passwords or remove our access.`,
      c.support
        ? `You're on our ${SUPPORT_FEE} support plan, so just reply to this email whenever you need an update.`
        : `Need updates later? Our ${SUPPORT_FEE} support plan covers text, photo and price changes, plus regular checks that your site is working. Just reply to add it.`,
    ],
  },
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const linkify = (escaped) => escaped.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#6c5cff">${url}</a>`);

const hasEmail = (status) => Boolean(TEMPLATES[status]);

// Returns { subject, text, html } or null when this status has no email.
function buildClientEmail(status, request, client, message = '') {
  const template = TEMPLATES[status];
  if (!template) return null;
  const first = String(client.name || '').trim().split(/\s+/)[0] || 'there';
  const paragraphs = template.body(request, { first, support: Boolean(client.support) });
  const personal = String(message || '').trim();
  if (personal) paragraphs.push(personal);
  const signoff = ['Thanks,', 'The FastWebsiteCreator team', 'fastwebsitecreator.com'];

  const text = [...paragraphs, signoff.join('\n')].join('\n\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2b3247;max-width:560px;line-height:1.6">
      ${paragraphs.map((p) => `<p style="margin:0 0 16px;white-space:pre-wrap">${linkify(escapeHtml(p))}</p>`).join('')}
      <p style="margin:24px 0 0;color:#5d6680">${signoff.map(escapeHtml).join('<br>')}</p>
    </div>`;
  return { subject: template.subject(request), text, html };
}

module.exports = { buildClientEmail, hasEmail };

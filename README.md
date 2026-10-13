# FastWebsiteCreator.com

Marketing website for **FastWebsiteCreator** — custom websites built from a client's concept for a **flat $59**,
first draft in **2–3 business days**, optional support for **$10/month**.

The website is plain HTML/CSS/JS with no build step. A small Node service in `api/` receives the project brief
form, including uploaded files, and emails it to you through [Resend](https://resend.com).

## Edit your business details

Everything you'll change often is in **`js/config.js`**:

| Setting        | What it does                                                                 |
|----------------|------------------------------------------------------------------------------|
| `email`        | Contact email shown on the site (and used if the upload service can't be reached) |
| `apiUrl`       | Address of the brief/upload service. Empty = form opens the visitor's email app instead (no uploads) |

Wording, prices and FAQ live in `index.html`; terms in `terms.html`.

## Preview locally

```bash
npx http-server -p 8080 .
# open http://localhost:8080
```

## Go live on fastwebsitecreator.com (Render, free)

1. In Render choose **New → Blueprint** and pick this repository. `render.yaml` creates a free static site
   that redeploys on every push to `main`.
2. In Render under **Settings → Custom Domains**, it shows the DNS records for `fastwebsitecreator.com` and `www`.
   Add them at your domain registrar. HTTPS is set up automatically.

Any static host works too (Netlify, Cloudflare Pages, GitHub Pages): publish the repository root.

## Backend (`api/`): project briefs, uploads and owner dashboard

Clients can upload up to 10 files (10 MB each, 25 MB total) with their brief. Every brief is:

- **saved** with its files, and listed in your owner dashboard, and
- **emailed** to build@fastwebsitecreator.com with the files attached (reply goes straight to the client).

### Owner dashboard: https://admin.fastwebsitecreator.com/admin

- **Project requests**: every brief with status filters (New → Reviewing → Awaiting payment → Building →
  Draft sent → Live, or Closed), search, uploaded files with image previews, and private notes.
- **Clients**: briefs are grouped by email address, so each client's projects are in one place, with their
  contact details, support plan and notes.

### Render settings

Render creates the backend from `render.yaml` as **fastwebsitecreator-api** (Starter plan with a 1 GB disk, so requests
and files survive restarts). In that service's **Environment** settings, set:

| Variable                          | Purpose                                                            |
|-----------------------------------|--------------------------------------------------------------------|
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`  | Your dashboard login (the dashboard stays off until both are set)  |
| `RESEND_API_KEY`                  | API key from resend.com, for the email notifications               |

`NOTIFY_EMAIL` (build@fastwebsitecreator.com) and `MAIL_FROM` (briefs@fastwebsitecreator.com) are set in `render.yaml`.
For those emails to arrive:

1. **Verify fastwebsitecreator.com in Resend** (Domains → Add domain) and add the DNS records it shows in GoDaddy.
   Until then Resend only sends to your Resend account's own address.
2. **Give build@ a mailbox or forward**, so it has MX records and can receive mail.

Briefs are always saved to the dashboard, even if an email can't be sent.

### Dashboard address

Add a **CNAME** record in GoDaddy: name `admin`, value `fastwebsitecreator-api.onrender.com`. Until it's verified,
the dashboard is also at https://fastwebsitecreator-api.onrender.com/admin.

```bash
cd api && npm install && npm test   # run the tests (Node 22.13+)
```

## Layout

```
index.html          Home page: hero, how it works, pricing, what you provide, FAQ, project brief form
terms.html          Terms of service (draft, have it reviewed)
404.html            Not-found page
css/style.css       All styles
js/config.js        Business settings
js/main.js          Mobile menu, project form and file uploads
api/                Backend (Node + Express + SQLite): brief form, uploads, emails, owner dashboard
img/                Favicon and social share image (og-image.png, 1200×627)
docs/               Client onboarding checklist
```

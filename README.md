# FastWebsiteCreator.com

Marketing website for **FastWebsiteCreator** — custom websites built from a client's concept for a **flat $99**,
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

## Brief & upload service (`api/`)

Clients can upload up to 10 files (10 MB each, 25 MB total): images, PDF, Word, PowerPoint, design files or ZIP.
Each brief arrives as an email with the files attached, and replying goes straight to the client.

Render creates it from `render.yaml` as **fastwebsitecreator-api**. In that service's **Environment** settings, set:

| Variable         | Purpose                                                                          |
|------------------|----------------------------------------------------------------------------------|
| `RESEND_API_KEY` | API key from resend.com (required)                                               |
| `NOTIFY_EMAIL`   | Where briefs go. Until your domain is verified in Resend, use your Resend account's email address |
| `MAIL_FROM`      | Optional, once fastwebsitecreator.com is verified in Resend, e.g. `FastWebsiteCreator <briefs@fastwebsitecreator.com>` |

The service is on Render's free plan, which sleeps when idle, so the first brief after a quiet spell can take
up to a minute to send. Switch it to **Starter** in Render to avoid that.

```bash
cd api && npm install && npm test   # run the tests
```

## Layout

```
index.html          Home page: hero, how it works, pricing, what you provide, FAQ, project brief form
terms.html          Terms of service (draft, have it reviewed)
404.html            Not-found page
css/style.css       All styles
js/config.js        Business settings
js/main.js          Mobile menu, project form and file uploads
api/                Brief/upload service (Node + Express), emails briefs via Resend
img/                Favicon and social share image (og-image.png, 1200×627)
docs/               Client onboarding checklist
```

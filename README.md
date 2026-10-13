# FastWebsiteCreator.com

Marketing website for **FastWebsiteCreator** — custom websites built from a client's concept for a **flat $99**,
first draft in **2–3 business days**, optional support for **$10/month**.

Plain HTML/CSS/JS, no build step, no server. It can be hosted free on any static host.

## Edit your business details

Everything you'll change often is in **`js/config.js`**:

| Setting        | What it does                                                                 |
|----------------|------------------------------------------------------------------------------|
| `email`        | Where project briefs go, and the email shown in the footer                   |
| `formEndpoint` | Optional form service URL (e.g. Formspree). Empty = form opens the visitor's email app with the brief pre-filled |

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

## Receive briefs straight to your inbox (recommended)

1. Create a free form at [formspree.io](https://formspree.io), using your business email.
2. Paste its endpoint (`https://formspree.io/f/xxxxxxx`) into `formEndpoint` in `js/config.js`.

## Layout

```
index.html          Home page: hero, how it works, pricing, what you provide, FAQ, project brief form
terms.html          Terms of service (draft, have it reviewed)
404.html            Not-found page
css/style.css       All styles
js/config.js        Business settings
js/main.js          Mobile menu + project form
img/                Favicon and social share image (og-image.png, 1200×627)
docs/               Client onboarding checklist
```

# David Myalik Store

A static e-commerce site for drift culture apparel brand "David Myalik / Sideways Always".

## Project Structure

- `index.html` — Single-page frontend with embedded CSS and JavaScript
- `api/checkout.js` — Netlify serverless function for Stripe checkout (not used in dev)
- `package.json` — Node.js project with `serve` for local static file serving

## Tech Stack

- Pure static HTML/CSS/JS (no build step)
- Tailwind CSS via CDN
- Stripe integration via Netlify Functions (for production)
- `serve` package for local development

## Running Locally

```bash
npm start
```

Serves the site on port 5000 at `http://0.0.0.0:5000`.

## Notes

- Stripe secret key is hardcoded in `api/checkout.js` (test key)
- The checkout API is a Netlify Function — it only works when deployed to Netlify or with a compatible serverless runtime
- In development, the checkout button will attempt to call `/.netlify/functions/checkout` which won't be available

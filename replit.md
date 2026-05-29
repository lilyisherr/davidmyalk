# David Myalik Store

A full-stack e-commerce site for drift culture apparel brand "David Myalik / Sideways Always".

## Project Structure

- `server.js` — Express server with all API routes, auth, and DB initialization
- `public/` — Static frontend (HTML, CSS, JS)
- `api/checkout.js` — Legacy Netlify serverless function (not used by the Express server)
- `package.json` — Node.js project dependencies

## Tech Stack

- Node.js + Express backend
- PostgreSQL database (Replit managed)
- JWT-based authentication (httpOnly cookies)
- Stripe integration for payments
- Pure HTML/CSS/Vanilla JS frontend

## Running

```bash
npm start
```

Serves the app on port 5000.

## Environment Variables / Secrets

- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned by Replit)
- `SESSION_SECRET` — JWT signing secret
- `STRIPE_SECRET_KEY` — Stripe secret key (set in Replit Secrets)
- `STRIPE_PUBLISHABLE_KEY` — Stripe publishable key (set in Replit Secrets)

## User Preferences

- Keep the dark drift-culture aesthetic throughout the UI
- Admin panel accessible at /admin
- First registered user gets "owner" role automatically

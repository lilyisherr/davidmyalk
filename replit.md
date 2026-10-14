# David Myalik Store

A full-stack e-commerce site for drift culture apparel brand "David Myalik / Sideways Always".

## Project Structure
- `server.js` — Express server with all API routes, auth, and DB initialization
- `public/` — Static frytend (HTML, CSS, JS
- `api/checkout.js` — Legacy Netlify serverless function (not used by the Express server
- `package.json` — Nodejs project dependencie

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
- `BOOTSTRAP_ADMIN_EMAIL` — exact email address allowed to create the initial owner account
- `SMTP_USER` / `SMTP_PASS` — dedicated Gmail account and Gmail app password for server email
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` — Gmail SMTP connection (`smtp.gmail.com`, `587`, `false`)
- `CONTACT_FORM_EMAIL` — private destination for contact form submissions
- `STRIPE_SECRET_KEY` — Stripe secret key (set in Replit Secrets)
- `STRIPE_PUBLISHABLE_KEY` — Stripe publishable key (set in Replit Secrets)

## User Preferences

- Keep the dark drift-culture aesthetic throughout the UI
- Admin panel accessible at /admin
- Public signups receive the customer role. Set `BOOTSTRAP_ADMIN_EMAIL` before the designated owner signs up; never grant admin access based on signup order.
- `/admin` and `/admin.html` are served only to authenticated admins/owners, and `/api/admin/*` endpoints enforce the same role check.
- See `setup_email.md` for Gmail app-password and deployment-secret setup.

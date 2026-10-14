# Gmail setup for contact and automated email

Use the dedicated store Gmail account `shopdavidmyalik@gmail.com` for contact messages and automated mail. The public contact address is okay to show on the website; the Gmail app password and SMTP credentials must remain private.

## 1. Create a Gmail app password

1. Create/sign in to `shopdavidmyalik@gmail.com` and enable **2-Step Verification** in its Google Account security settings.
2. Open Google Account → **Security** → **App passwords**. Create an app password named `DAVID MYALIK Store` and copy the 16-character password Google shows. If Google does not offer App passwords, verify 2-Step Verification is enabled and that the account is not managed or enrolled in Advanced Protection.
3. Use this generated app password as `SMTP_PASS`. It is not the account's normal password. Revoke it and generate a replacement if it is ever exposed.

## 2. Add deployment secrets

In your hosting provider's private environment/secrets settings, add these values for the production deployment (and preview deployments only if needed):

| Variable | Value |
| --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` (STARTTLS on port 587) |
| `SMTP_USER` | `shopdavidmyalik@gmail.com` |
| `SMTP_PASS` | The Gmail app password from step 1 |
| `SMTP_FROM_NAME` | `David Myalik Store` |
| `SMTP_FROM_EMAIL` | `shopdavidmyalik@gmail.com` |
| `CONTACT_FORM_EMAIL` | `shopdavidmyalik@gmail.com` |

On **Vercel**, add these in **Project → Settings → Environment Variables**, set the Production environment (and Preview if you want to test email on preview URLs), then redeploy so the running server receives them. Keep `SMTP_PASS` marked encrypted/private. Never put values in `vercel.json`, `.replit`, source files, or screenshots.

Set the public email to `shopdavidmyalik@gmail.com` under **Admin → Settings → General → Public Contact Email**. This is the customer-facing address shown on the Contact, Returns, Help, and policy pages. The private SMTP account settings, contact-form recipient, admin notification address, and app password are not returned by public settings endpoints.

## 3. Test delivery

Sign in to the admin account, open **Admin → Settings → Notifications**, and click **Send Test Email**. Submit a test message from the public Contact page and check `shopdavidmyalik@gmail.com`, its spam folder, and the Vercel function logs if it does not arrive. The contact form stores submissions in the configured database before attempting email delivery.

For a contact auto-reply, enable and save the contact auto-reply template on the same Notifications panel. Email credentials still belong in deployment secrets; never enter a Gmail password in the dashboard.

## Before opening the store

Gmail SMTP is suitable for initial low-volume testing, but it has sending limits and is not a bulk-mail service. Use a dedicated sender account, follow Google's sending rules, and move to a transactional email provider when order volume grows. Verify that `SMTP_FROM_EMAIL` is an address Gmail is allowed to send as.

The app needs a PostgreSQL `DATABASE_URL` and a long random `SESSION_SECRET` for accounts and settings. Set `BOOTSTRAP_ADMIN_EMAIL` to the exact email address that should become the store owner **before** that address signs up. Public signups are customers; the first account is no longer automatically an administrator. Set Stripe's live keys separately before accepting real payments.

For reliable paid-order updates, configure a Stripe webhook for `checkout.session.completed` and `checkout.session.async_payment_succeeded` at `https://<your-domain>/api/stripe/webhook`. Add the endpoint's signing secret as the private Vercel environment variable `STRIPE_WEBHOOK_SECRET`, then redeploy. Keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` private. Checkout completion is also verified server-side when the customer returns to the store.

## If accounts or admin data appear missing

`server.js` reads `DATABASE_URL` directly. In Vercel, make sure it is enabled for the environment serving the site (usually **Production**, not only Preview), and redeploy after changing it. All deployments using the same database URL share that database; changing the URL points the site at a different set of users, orders, and settings. The admin dashboard lists accounts that exist in that connected database; it does not migrate accounts from another database.

Admin account and activity endpoints are available only to signed-in users whose database role is `admin` or `owner`. The activity log can show only actions actually written to the log table; it cannot reconstruct events from before they were recorded.

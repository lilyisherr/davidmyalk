# Gmail setup for contact and automated email

Use a separate Gmail account for the store (for example, `yourstore.mail@gmail.com`). Do not use your personal inbox, and do not commit any email password or secret to this repository.

## 1. Create a Gmail app password

1. Sign in to the store Gmail account and enable 2-Step Verification in its Google Account security settings.
2. Open the Google Account **App passwords** page, create an app password for this website, and copy the generated password. Google may hide this option for managed accounts or accounts enrolled in Advanced Protection.
3. Use this app password as `SMTP_PASS`. It is not your normal Google password. Revoke and replace it if it is ever exposed.

## 2. Add deployment secrets

In your hosting provider's private environment/secrets settings, add these values for the production deployment (and preview deployments only if needed):

| Variable | Value |
| --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` (STARTTLS on port 587) |
| `SMTP_USER` | The full store Gmail address |
| `SMTP_PASS` | The Gmail app password from step 1 |
| `SMTP_FROM_NAME` | `David Myalik Store` |
| `SMTP_FROM_EMAIL` | The same Gmail address as `SMTP_USER` |
| `CONTACT_FORM_EMAIL` | The inbox that should receive contact submissions; usually the store Gmail address |

On **Vercel**, add these in **Project → Settings → Environment Variables**, select the Production environment, then redeploy. On **Replit**, add them in **Tools → Secrets**, then restart/redeploy the app. Never put values in `vercel.json`, `.replit`, source files, or screenshots.

The contact email shown publicly is separate: after signing in as an admin, set it under **Admin → Settings → General → Public Contact Email**. It is safe for this address to be a customer-facing alias. The private SMTP account, contact-form recipient, admin notification address, and mail password are not returned by public settings endpoints.

## 3. Test delivery

Sign in to the admin account, open **Admin → Settings → Notifications**, save the sender/recipient details if you use the dashboard fields, and click **Send Test Email**. Submit a test message from the public Contact page and check the recipient's inbox, spam folder, and the deployment logs if it does not arrive. The contact form stores submissions in the configured database before attempting email delivery.

For a contact auto-reply, enable and save the contact auto-reply template on the same Notifications panel. Email credentials still belong in deployment secrets; never enter a Gmail password in the dashboard.

## Before opening the store

Gmail SMTP is suitable for initial low-volume testing, but it has sending limits and is not a bulk-mail service. Use a dedicated sender account, follow Google's sending rules, and move to a transactional email provider when order volume grows. Verify that `SMTP_FROM_EMAIL` is an address Gmail is allowed to send as.

The app needs a PostgreSQL `DATABASE_URL` and a long random `SESSION_SECRET` for accounts and settings. Set `BOOTSTRAP_ADMIN_EMAIL` to the exact email address that should become the store owner **before** that address signs up. Public signups are customers; the first account is no longer automatically an administrator. Set Stripe's live keys separately before accepting real payments.

## If accounts or admin data appear missing

`server.js` reads `DATABASE_URL` directly. In Vercel, make sure it is enabled for the environment serving the site (usually **Production**, not only Preview), and redeploy after changing it. All deployments using the same database URL share that database; changing the URL points the site at a different set of users, orders, and settings. The admin dashboard lists accounts that exist in that connected database; it does not migrate accounts from another database.

Admin account and activity endpoints are available only to signed-in users whose database role is `admin` or `owner`. The activity log can show only actions actually written to the log table; it cannot reconstruct events from before they were recorded.

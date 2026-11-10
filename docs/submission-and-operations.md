# Submission and operations handoff

## What is implemented

- Next.js customer site and sign-in flow, NestJS API, PostgreSQL/Prisma schema and migrations.
- Customer registration, login, booking search/hold, Razorpay order and signature verification, invoices, reservation history, and cancellation requests.
- Role-based admin/staff views, staff account creation/listing, room operations, nightly rate ranges, promotion codes, check-in/check-out, housekeeping, maintenance, and audit records.
- In-app notifications for booking and selected operational events. Email delivery is not configured; add an email provider and credentials before promising email confirmations.

## Local acceptance checks

Run the backend unit tests and production build from `resort-backend` (`npm test`, `npm run build`). Run `npm run build` from `resort-frontend`. Start the database and both apps, then walk through the manual checks listed in the root README. The Razorpay flow should be exercised with test credentials and test-mode payment methods only.

## Production launch checklist

1. Choose and provision a host for the frontend and API, a managed PostgreSQL database, and a domain with HTTPS. Redis is present in local Compose; configure a hosted Redis service only if the deployed runtime uses it.
2. Create separate production environment variables. Set `DATABASE_URL`, `JWT_SECRET` (unique random value, at least 32 characters), `PROPERTY_NAME`, `PROPERTY_SLUG`, `FRONTEND_ORIGIN`, and `PORT` for the backend. Set `NEXT_PUBLIC_API_URL` to the HTTPS API URL ending in `/api/v1` for the frontend.
3. Apply database migrations with `npm run prisma:deploy` from `resort-backend`. Seed only the initial production administrator using a secure, temporary initial password, then change that password and remove the seed-only credentials from the deployment environment.
4. Configure Razorpay production keys only after merchant activation and HTTPS are ready. Create a webhook targeting `https://<api-domain>/api/v1/payments/webhook`, select the payment/refund events the service handles, and store its separate signing secret as `RAZORPAY_WEBHOOK_SECRET`.
5. Configure backups and test a restore before launch. Keep a protected copy of environment secrets outside the repository. Never place backend secrets in `NEXT_PUBLIC_*` variables or commit `.env` files.
6. Verify CORS allows only the production website origin, Swagger exposure matches the deployment policy, health checks pass, webhook delivery is acknowledged, and one end-to-end test booking/refund is reconciled in Razorpay and the database.

## PostgreSQL backup and restore example

Use a protected terminal and the database provider's recommended backup tooling. For a direct PostgreSQL connection, a custom-format backup can be created with:

```powershell
pg_dump --format=custom --no-owner --file=aranya-backup.dump "$env:DATABASE_URL"
```

Restore to a new/empty database after verifying the destination:

```powershell
pg_restore --no-owner --clean --if-exists --dbname="$env:RESTORE_DATABASE_URL" aranya-backup.dump
```

Do not restore over the live production database as a first restore test. Follow the provider's retention and encryption guidance and periodically test restoration.

## Known external setup still required

- Hosting account, production database, domain, TLS, and deployment secrets.
- Razorpay production merchant activation and live credentials.
- Email provider credentials if email delivery is required. The current notification interface is in-app.
- Operational decisions such as final cancellation/refund policy, tax/invoice requirements, privacy/retention wording, and the real property's inventory and rates.

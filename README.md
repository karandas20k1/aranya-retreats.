# Aranya Retreats · Resort Management & Booking

Full stack resort booking and operations project. The public site is built with Next.js; the REST API uses NestJS and Prisma; PostgreSQL stores resort, booking, payment, and operations data. See [architecture](docs/architecture.md) and the [submission & operations guide](docs/submission-and-operations.md).

## Features

- Public resort website with room availability, date and guest selection, guest details, room holds, promotion codes, and Razorpay checkout.
- Customer sign-in/account controls on the public website, reservation history, invoices, and cancellation requests.
- Role-based staff sign-in for administrators, managers, reception, housekeeping, and maintenance.
- Admin tools for staff accounts, rooms/categories, inventory, nightly rates, offers, bookings, cancellation/refunds, and audit history.
- Operations screens for check-in/check-out, housekeeping, maintenance, and in-app notifications.
- PostgreSQL schema and migrations, development seed, API health endpoint, and Swagger docs.

## Stack and requirements

- Node.js 24 or later, npm, and Docker Desktop with Compose.
- Next.js 16, React 19, NestJS 12, Prisma 7, PostgreSQL 17, Redis 7.
- Razorpay test credentials for payment testing. No live payment credentials are included.

## Run locally (PowerShell)

1. In the project root, copy `.env.example` to `.env` and set a strong `POSTGRES_PASSWORD`.
2. Copy `resort-backend/.env.example` to `resort-backend/.env`. Set `DATABASE_URL` to the local PostgreSQL connection, `JWT_SECRET` to a random value with at least 32 characters, and the initial admin email/password. The initial password must be at least 8 characters.
3. Copy `resort-frontend/.env.example` to `resort-frontend/.env.local`. For local development, `NEXT_PUBLIC_API_URL` should be `http://localhost:4000/api/v1`.
4. Start PostgreSQL and Redis from the project root: `docker compose up -d postgres redis`.
5. Open a terminal in `resort-backend` and run `npm install`, `npm run prisma:generate`, `npm run prisma:migrate`, `npm run prisma:seed`, then `npm run start:dev`.
6. Open another terminal in `resort-frontend` and run `npm install`, then `npm run dev`.
7. Open `http://localhost:3000`. API health is at `http://localhost:4000/api/v1/health`; Swagger is at `http://localhost:4000/docs`.

Keep `.env`, `.env.local`, passwords, JWT secrets, and Razorpay secrets private. Razorpay Checkout runs in test mode when test keys are configured. For webhooks, configure an HTTPS public endpoint ending in `/api/v1/payments/webhook`, subscribe to payment and refund events used by the app, and copy the webhook signing secret into `RAZORPAY_WEBHOOK_SECRET`.

## Checks before handoff

From `resort-backend`: `npm test`, `npm run build`, and `npm run lint`.

From `resort-frontend`: `npm run build`.

Then manually verify customer registration/login, room search and hold, promo application, Razorpay test payment, customer reservation/invoice view, staff role routing, rate/promo administration, check-in/out, housekeeping, maintenance, and cancellation handling. Full public deployment still needs hosting, domain, production database, production Razorpay credentials, and a reachable webhook URL; see the operations guide.

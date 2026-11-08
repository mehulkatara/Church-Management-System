# Church Management System

A multi-church administration, financial accounting, member management, and donation tracking application built with **React**, **TypeScript**, **Vite**, **Tailwind CSS**, and **Supabase PostgreSQL**.

Designed for financial-record accuracy, simple mobile-friendly workflows (including phone-based SMS confirmation), strict role-based access control, and low ongoing infrastructure costs with Cloudflare Workers Static Assets deployment.

---

## Architecture & Technology Stack

- **Frontend**: React 19 + TypeScript, Vite 8, Tailwind CSS, Lucide Icons, installable PWA with public application shell caching only.
- **Database & Auth**: Supabase PostgreSQL with Row Level Security (RLS) on all 18 tables, atomic stored procedures, and Supabase Auth.
- **Serverless & Workers**: Supabase Edge Functions for durable SMS notification dispatching.
- **Deployment**: Cloudflare Workers Static Assets with SPA routing (`wrangler.jsonc`, `_routes.json`, and `_headers`).
- **Reports**: Real PDF generation (`jspdf` + `jspdf-autotable`) and Excel spreadsheets (`xlsx`) with formula injection sanitization.

---

## Role & Permission Enforcement Matrix

| Operation / Capability | Platform Admin | Church Admin | Accountant | Collector | Member |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Create & Manage Churches** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Assign Staff Roles** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Record New Donation** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Change Active/Inactive Member Status** | ⚠️ *(Accountant role req.)* | ⚠️ *(Accountant role req.)* | ✅ *(Reason req.)* | ❌ | ❌ |
| **Edit Village Name** | ✅ | ✅ | ✅ | ❌ | ❌ *(Read-only)* |
| **Edit Gender** | ✅ | ✅ | ✅ | ❌ | ✅ *(Own profile only)* |
| **Correct / Soft-Delete Donations** | ✅ *(Reason req.)* | ✅ *(Reason req.)* | ✅ *(Reason req.)* | ❌ | ❌ |
| **Approve Member Access Requests** | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Bulk Financial & Member Exports** | ✅ | ✅ | ✅ | ❌ | ❌ *(Own PDF only)* |
| **View Church Audit History** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **View All Church Donations** | ✅ | ✅ | ✅ | ✅ | ❌ *(Own only)* |

> **Critical Rule**: The Admin role alone **CANNOT** change member Active/Inactive status. Only a user with an explicit, current **Accountant** assignment for that church may alter membership status, and a mandatory audit reason is enforced at the database level (`public.change_member_status`).

---

## 1. Creating a Supabase Development Project

1. Log in to [Supabase](https://supabase.com) and click **New project**.
2. Select an organization, choose an appropriate cloud region (e.g. `ap-south-1` Mumbai or `ap-southeast-1` Singapore), and choose a strong database password.
3. Once provisioned, navigate to **Project Settings** &rarr; **API & Auth** &rarr; **Data API**:
   - Copy **Project URL** (e.g., `https://xyzcompany.supabase.co`).
   - Copy **anon public API key** (`sb_publishable_...` or JWT).

---

## 2. Applying Migrations

Open the **SQL Editor** in your Supabase project dashboard:

1. **Schema & RLS**: Open and execute `supabase/migrations/20261108000001_initial_schema.sql`.
   - Creates the 18 core tables, foreign keys, uniqueness constraints, and Row Level Security policies.
2. **Atomic Procedures**: Open and execute `supabase/migrations/20261108000002_atomic_functions.sql`.
   - Installs atomic business functions:
     - `public.record_donation()`
     - `public.correct_donation()`
     - `public.cancel_donation()`
     - `public.change_member_status()`
     - `public.approve_access_request()`
3. *(Optional Dev Testing Only)*: Execute `supabase/seed.sql` to populate sample churches, categories, accounts, and member roster. Never run seed scripts in production.

---

## 3. Supplying Frontend Configuration

Create a `.env` file in the project root:

```bash
# Frontend Supabase Configuration (Public, safe for browser)
VITE_SUPABASE_URL="https://your-project-id.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="your-anon-publishable-key-here"
```

*Note: Never expose Supabase `service_role` keys, database passwords, or SMS API keys in frontend code or repository `.env` files.*

---

## 4. Setting Server-Only Secrets

For Supabase Edge Functions (such as the SMS notification worker in `supabase/functions/notification-worker`):
1. In the Supabase Dashboard, go to **Project Settings** &rarr; **Secrets** (or **Vault**).
2. Configure:
   - `SUPABASE_SERVICE_ROLE_KEY`: Service role secret for background jobs.
   - `SMS_PROVIDER_API_KEY`: API token for your registered telecom gateway.
   - `SMS_PROVIDER_SENDER_ID`: Registered DLT sender ID (e.g. `CHURCH`).

---

## 5. Configuring Email Verification and Password-Reset Delivery

1. In Supabase Dashboard, go to **Authentication** &rarr; **Email Templates**.
2. Customize the **Confirm Signup** and **Reset Password** templates.
3. For production email delivery, connect an external SMTP provider (such as Resend, Amazon SES, or SendGrid) under **Authentication** &rarr; **SMTP Settings**.

---

## 6. Setting Authentication Site and Redirect URLs

Under **Authentication** &rarr; **URL Configuration**:
- **Site URL**: `https://your-domain.com` (or preview URL during development).
- **Redirect URLs**:
  - `http://localhost:3000/**`
  - `https://*.run.app/**`
  - `https://your-domain.pages.dev/**`

---

## 7. Bootstrapping the First Admin & Assigning First Accountant

By specification, **the first registrant is never granted Admin automatically**. Follow this controlled bootstrap procedure:

1. Register an administrator account through the application's self-registration screen or directly via Supabase Auth.
2. In the Supabase **SQL Editor**, grant Platform Admin privileges:

```sql
-- Replace with the registered administrator's email:
INSERT INTO public.platform_admins (user_id, notes)
SELECT id, 'Initial platform administrator setup'
FROM auth.users
WHERE email = 'admin@yourchurch.org';
```

3. To assign an Accountant for a church:

```sql
INSERT INTO public.church_access (church_id, user_id, role, status, notes)
SELECT 'a1000000-0000-0000-0000-000000000001', id, 'accountant', 'approved', 'Initial church accountant'
FROM auth.users
WHERE email = 'accountant@yourchurch.org';
```

---

## 8. Exporting Code to a Private Git Repository

```bash
git init
git add .
git commit -m "Initial commit of Church Management System"
git branch -M main
git remote add origin git@github.com:your-organization/church-management-system.git
git push -u origin main
```

---

## 9. Deploying Frontend to Cloudflare Workers Static Assets

The repository contains `wrangler.jsonc`, `public/_headers`, and `public/_routes.json` preconfigured for Cloudflare Static Assets:

```bash
# 1. Build the frontend production bundle
npm run build

# 2. Deploy to Cloudflare Workers Static Assets
npx wrangler deploy
```

SPA single-page application routing is handled automatically via `"not_found_handling": "single-page-application"`.

---

## 10. Separating Development from Production

- Maintain two distinct Supabase projects: `church-cms-dev` and `church-cms-prod`.
- Use `supabase/seed.sql` only on the development project.
- In production, ensure `anon` public key is restricted by RLS, and test that all unauthenticated queries receive 0 rows.

---

## 11. Configuring Optional Automatic SMS

1. **Mode A (Send from my phone)** is active by default:
   - When a donation is saved, staff can tap **Send SMS from my phone**.
   - Opens the device's native SMS composer (`sms:recipient?body=...`) with recipient and text pre-filled.
   - Zero carrier gateway setup or extra infrastructure costs.
2. **Mode B (Automatic SMS Gateway)**:
   - Deploy the Edge function: `supabase functions deploy notification-worker`.
   - Set up a cron schedule via pg_cron or Supabase Scheduled Functions.
   - Failures in SMS dispatch never cancel or revert saved donations.

---

## 12. Backups, Restoration Checks & Pre-Launch Security Checklist

- [x] RLS enabled on all 18 database tables.
- [x] Receipt number registry enforces case-insensitive church-scoped uniqueness (`uq_church_normalized_receipt`).
- [x] Membership status modification restricted to current church Accountants with mandatory reasons.
- [x] Platform Admin alone cannot alter Active/Inactive member status.
- [x] Village Name and Gender excluded from public self-registration.
- [x] Competition ranking (1, 2, 2, 4) handles equal donation totals with stable secondary ordering.
- [x] Soft deletion preserves audit snapshots; cancellations leave receipt numbers permanently reserved.
- [x] Excel spreadsheet export sanitizes cells starting with `=`, `+`, `-`, `@` to prevent formula injection.
- [x] Public shell caching only; confidential APIs, donations, and members are never cached offline.
- [x] Run automated domain logic unit tests: `npx --yes tsx --test src/lib/domain-logic.test.ts`.

## Google Authentication & Onboarding Workflow

The Church Management System enforces a strict **Google-only authentication and Accountant-verified onboarding** architecture.

### Workflow Lifecycle

```
[Continue with Google]
         ↓
Supabase authenticates Google account (UUID created in auth.users)
         ↓
Mandatory First-Login Profile Form ("Complete Your Profile")
  • Google login email (Read-only, verified)
  • Full Name (Unicode text, prefilled from Google)
  • Date of Birth (Calendar date; future/invalid dates rejected)
  • Phone Number (+91 default country code selector)
  • Gender (Explicit choices: Male, Female, Other, Prefer not to say)
  • Village / City Name (Canonical locality text)
  • Church Selection
         ↓
Draft saving allowed OR Submit to Church Accountant
         ↓
Accountant reviews in "Member Access Approvals"
  • Side-by-side reconciliation table:
    [Field | Existing Member Value | Applicant Value | Final Reviewed Value]
  • Choose: Map to Existing Member OR Create New Member
  • Concurrency protection via submission_version check
  • Actions: Approve & Link, Return for Correction, or Reject
         ↓
Applicant gains verified Member access to their own statements & ranking.
```

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

1. **Schema & RLS**: Execute `supabase/migrations/20261108000001_initial_schema.sql`.
   - Creates the core tables, foreign keys, uniqueness constraints, and Row Level Security policies.
2. **Atomic Procedures**: Execute `supabase/migrations/20261108000002_atomic_functions.sql`.
   - Installs atomic business functions (`record_donation`, `change_member_status`, `correct_donation`, `cancel_donation`).
3. **Google Auth & Onboarding**: Execute `supabase/migrations/20261109000001_google_auth_and_onboarding.sql`.
   - Adds `date_of_birth` to `members` and `access_requests`.
   - Adds `submission_version`, `is_draft`, `reviewed_fields_snapshot` to `access_requests`.
   - Installs `submit_profile_request`, `approve_access_request_v2`, and `return_access_request_for_correction`.

---

## 3. Configuring Google OAuth Provider in Supabase

1. Open your [Google Cloud Console](https://console.cloud.google.com/) &rarr; **APIs & Services** &rarr; **Credentials**.
2. Create an **OAuth 2.0 Client ID** (Web Application).
3. Set **Authorized redirect URIs** to your Supabase callback URL:
   `https://<YOUR-PROJECT-REF>.supabase.co/auth/v1/callback`
4. Copy the **Client ID** and **Client Secret**.
5. In your Supabase Dashboard:
   - Go to **Authentication** &rarr; **Providers** &rarr; **Google**.
   - Toggle **Enable Google provider** to **ON**.
   - Paste **Client ID** and **Client Secret**.
   - Save changes.

---

## 4. Disabling Legacy Email/Password Authentication (Cutover)

To enforce Google-only sign-in and eliminate password vectors:
1. In the Supabase Dashboard, navigate to **Authentication** &rarr; **Providers** &rarr; **Email**.
2. Toggle **Enable Email provider** to **OFF**.
3. Ensure Phone and other passwordless providers are disabled.
4. Google OAuth accounts and Google Workspace domains will remain the exclusive authentication pathway.

---

## 5. Supplying Frontend Configuration

Create a `.env` file in the project root:

```bash
# Frontend Supabase Configuration (Public, safe for browser)
VITE_SUPABASE_URL="https://your-project-id.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="your-anon-publishable-key-here"
```

*Note: Never expose Supabase `service_role` keys, database passwords, or SMS API keys in frontend code or repository `.env` files.*

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

By specification, **the first Google registrant is never granted Admin automatically**. Follow this controlled bootstrap procedure:

1. Sign in with your Google account through the application's "Continue with Google" button.
2. In the Supabase **SQL Editor**, grant Platform Admin privileges:

```sql
-- Replace with your authenticated Google email:
INSERT INTO public.platform_admins (user_id, notes)
SELECT id, 'Initial platform administrator setup via Google'
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
git commit -m "Church Management System with Google-only Auth and Accountant Onboarding"
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

## 10. Pre-Launch Security & Business Rules Checklist

- [x] Google-only authentication; email/password, magic link, and phone login removed from UI.
- [x] Google login email strictly read-only and immutable.
- [x] Date of birth is a calendar DATE, rejecting future and invalid dates.
- [x] Village Name updated to canonical label "Village / City Name" across entire app without breaking database columns.
- [x] Accountant-only side-by-side reconciliation table with choices: Existing, Applicant, or Custom.
- [x] Version concurrency protection on access approvals (`p_expected_version`).
- [x] Return for Correction flow with audit reason visible to applicant.
- [x] Membership status modification strictly restricted to church Accountants with mandatory reasons.
- [x] Manual receipt number uniqueness enforced across all financial years (`uq_church_normalized_receipt`).
- [x] Competition ranking (1, 2, 2, 4) includes inactive members' valid donations with stable secondary ordering.
- [x] Soft deletion preserves audit snapshots; cancellations leave receipt numbers permanently reserved.
- [x] Excel spreadsheet export sanitizes cells starting with `=`, `+`, `-`, `@` to prevent formula injection.
- [x] Run automated domain logic unit tests: `npx --yes tsx --test src/lib/domain-logic.test.ts`.

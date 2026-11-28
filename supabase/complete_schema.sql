-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - ALWAYS-UPDATED COMPLETE SCHEMA & FULL RESET SCRIPT
-- File: supabase/complete_schema.sql
-- Note: Canonical single-file PostgreSQL schema (currently 22 tables, RLS
--       policies, triggers, and atomic RPCs).
-- WARNING: DESTRUCTIVE RESET!
-- Running this script deletes ALL existing tables, views, functions, triggers,
-- policies, and data in the `public` schema, then recreates everything cleanly:
--   0. Drops existing trigger on auth.users and all non-extension public objects
--   1. Creates all 22 tables, constraints, and indexes
--   2. Creates auth.users -> public.profiles sync trigger
--   3. Enables Row Level Security (RLS) on ALL 22 tables + complete policies
--   4. Installs deterministic role helper functions
--   5. Installs all SECURITY DEFINER atomic RPCs
--   6. Backfills public.profiles from any existing auth.users rows
-- ==============================================================================


-- ==============================================================================
-- SECTION 0: FULL RESET (DELETE EVERYTHING EXISTING IN PUBLIC SCHEMA)
-- ==============================================================================

-- Remove auth sync trigger first
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Optional: Uncomment the line below ONLY if you also want to wipe all login
-- accounts from Supabase Auth (otherwise existing Google logins stay intact):
-- DELETE FROM auth.users;

-- Drop all existing views, tables, functions, procedures, and custom types in public
-- while preserving PostgreSQL extension objects (e.g. uuid-ossp).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('v', 'm')
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = c.oid AND d.deptype = 'e'
          )
    ) LOOP
        IF r.relkind = 'm' THEN
            EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE', r.relname);
        ELSE
            EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.relname);
        END IF;
    END LOOP;

    FOR r IN (
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = c.oid AND d.deptype = 'e'
          )
    ) LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname);
    END LOOP;

    FOR r IN (
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'S'
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = c.oid AND d.deptype = 'e'
          )
    ) LOOP
        EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.relname);
    END LOOP;

    FOR r IN (
        SELECT
            n.nspname,
            p.proname,
            pg_get_function_identity_arguments(p.oid) AS identity_args,
            p.prokind
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = p.oid AND d.deptype = 'e'
          )
    ) LOOP
        IF r.prokind = 'p' THEN
            EXECUTE format('DROP PROCEDURE IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.identity_args);
        ELSIF r.prokind = 'a' THEN
            EXECUTE format('DROP AGGREGATE IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.identity_args);
        ELSE
            EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE', r.nspname, r.proname, r.identity_args);
        END IF;
    END LOOP;

    FOR r IN (
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype IN ('e', 'd')
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = t.oid AND d.deptype = 'e'
          )
    ) LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
    END LOOP;
END $$;

-- Enable UUID & cryptographic extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- SECTION 1: TABLES & INDEXES
-- ==============================================================================

-- 1. CHURCHES
CREATE TABLE IF NOT EXISTS public.churches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL CONSTRAINT chk_churches_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 64),
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    email TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_churches_slug ON public.churches (lower(slug));

-- 2. USER PROFILES (mirrors auth.users safely)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 3. PLATFORM ADMINS (Explicit platform-wide privileges)
CREATE TABLE IF NOT EXISTS public.platform_admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_by UUID REFERENCES auth.users(id)
);

-- 4. CHURCH ACCESS (Church-specific roles: admin, accountant, collector, member)
CREATE TABLE IF NOT EXISTS public.church_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'accountant', 'collector', 'member')),
    status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'suspended')),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    granted_by UUID REFERENCES auth.users(id),
    notes TEXT,
    CONSTRAINT uq_church_user_role UNIQUE (church_id, user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_church_access_user ON public.church_access(user_id);
CREATE INDEX IF NOT EXISTS idx_church_access_church ON public.church_access(church_id);

-- 5. MEMBERS (Physical member records independent of login accounts)
CREATE TABLE IF NOT EXISTS public.members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE RESTRICT,
    member_number TEXT NOT NULL,
    full_name TEXT NOT NULL,
    contact_phone TEXT,
    village_name TEXT,
    gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
    date_of_birth DATE,
    joining_date DATE NOT NULL DEFAULT CURRENT_DATE,
    membership_status TEXT NOT NULL DEFAULT 'active' CHECK (membership_status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    CONSTRAINT uq_church_member_number UNIQUE (church_id, member_number)
);
CREATE INDEX IF NOT EXISTS idx_members_church ON public.members(church_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON public.members(church_id, membership_status);

-- 6. MEMBER ACCOUNT LINKS (1:1 mapping between auth account and member within a church)
CREATE TABLE IF NOT EXISTS public.member_account_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    linked_by UUID REFERENCES auth.users(id),
    CONSTRAINT uq_member_account_link_church_member UNIQUE (church_id, member_id),
    CONSTRAINT uq_member_account_link_church_user UNIQUE (church_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_member_account_links_user ON public.member_account_links(user_id);

-- 7. ACCESS REQUESTS (Self-registration & Google OAuth onboarding queue)
CREATE TABLE IF NOT EXISTS public.access_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    applicant_name TEXT NOT NULL,
    applicant_email TEXT NOT NULL,
    applicant_phone TEXT,
    date_of_birth DATE,
    gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
    village_name TEXT,
    submission_version INT NOT NULL DEFAULT 1,
    is_draft BOOLEAN NOT NULL DEFAULT false,
    reviewed_fields_snapshot JSONB,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'returned_for_correction', 'suspended')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    decided_at TIMESTAMPTZ,
    decided_by UUID REFERENCES auth.users(id),
    decision_reason TEXT,
    linked_member_id UUID REFERENCES public.members(id)
);
CREATE INDEX IF NOT EXISTS idx_access_requests_church_status ON public.access_requests(church_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_access_request_per_church
    ON public.access_requests (church_id, user_id)
    WHERE status IN ('draft', 'pending', 'returned_for_correction');

-- 8. DONATION CATEGORIES
CREATE TABLE IF NOT EXISTS public.donation_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 9. RECEIVING ACCOUNTS
CREATE TABLE IF NOT EXISTS public.receiving_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    account_name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK (account_type IN ('cash', 'bank')),
    bank_name TEXT,
    account_number_mask TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_receiving_accounts_church
    ON public.receiving_accounts(church_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_receiving_accounts_church_name
    ON public.receiving_accounts (church_id, lower(trim(account_name)));

-- 10. DONATIONS
CREATE TABLE IF NOT EXISTS public.donations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE RESTRICT,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
    receipt_number TEXT NOT NULL,
    donation_date DATE NOT NULL,
    category_id UUID NOT NULL REFERENCES public.donation_categories(id) ON DELETE RESTRICT,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    receiving_account_id UUID NOT NULL REFERENCES public.receiving_accounts(id) ON DELETE RESTRICT,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other')),
    payment_reference TEXT,
    notes TEXT,
    idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_by UUID REFERENCES auth.users(id),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES auth.users(id),
    deletion_reason TEXT,
    CONSTRAINT uq_donation_idempotency UNIQUE (church_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_donations_church_date ON public.donations(church_id, donation_date);
CREATE INDEX IF NOT EXISTS idx_donations_member ON public.donations(member_id);
CREATE INDEX IF NOT EXISTS idx_donations_active ON public.donations(church_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_donations_church_receipt
    ON public.donations (church_id, lower(trim(receipt_number)))
    WHERE deleted_at IS NULL;

-- 11. DONATION REVISIONS (Append-only history of creations, corrections, and cancellations)
CREATE TABLE IF NOT EXISTS public.donation_revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    donation_id UUID NOT NULL REFERENCES public.donations(id) ON DELETE RESTRICT,
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE RESTRICT,
    revision_number INT NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('created', 'corrected', 'cancelled')),
    previous_snapshot JSONB,
    new_snapshot JSONB NOT NULL,
    actor_user_id UUID REFERENCES auth.users(id),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_donation_revision_seq UNIQUE (donation_id, revision_number)
);
CREATE INDEX IF NOT EXISTS idx_donation_revisions_donation ON public.donation_revisions(donation_id);

-- 13. AUDIT LOGS (Append-only system-wide audit trail)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID REFERENCES public.churches(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    change_summary TEXT NOT NULL,
    previous_state JSONB,
    new_state JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_church ON public.audit_logs(church_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_user_id, created_at DESC);

-- 14. CHURCH SETTINGS
CREATE TABLE IF NOT EXISTS public.church_settings (
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    setting_key TEXT NOT NULL,
    setting_value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_by UUID REFERENCES auth.users(id),
    PRIMARY KEY (church_id, setting_key)
);

-- 15. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(recipient_user_id, read);

-- 16. NOTIFICATION JOBS (Durable SMS queue)
CREATE TABLE IF NOT EXISTS public.notification_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    donation_id UUID REFERENCES public.donations(id) ON DELETE SET NULL,
    recipient_phone TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    message_body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'queued', 'submitted', 'delivered', 'failed', 'unknown')),
    provider TEXT,
    external_id TEXT,
    attempts_count INT NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_status ON public.notification_jobs(status, created_at);

-- 17. NOTIFICATION ATTEMPTS
CREATE TABLE IF NOT EXISTS public.notification_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES public.notification_jobs(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL,
    status TEXT NOT NULL,
    response_payload JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 18. REPORT EXPORTS (Audit of generated PDF/Excel reports)
CREATE TABLE IF NOT EXISTS public.report_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    report_type TEXT NOT NULL,
    financial_year TEXT NOT NULL,
    filters JSONB,
    row_count INT NOT NULL DEFAULT 0,
    generated_by UUID REFERENCES auth.users(id),
    file_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 19. MEMBER SHARE LINKS (Single-use, unauthenticated view-only member portal links)
CREATE TABLE IF NOT EXISTS public.member_share_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'revoked')),
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_member_share_links_member ON public.member_share_links(church_id, member_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_share_links_one_active
    ON public.member_share_links(church_id, member_id)
    WHERE status = 'active';

-- 20. CHURCH SMS GATEWAYS (Private Plan B Android SMS Gateway credentials; no direct client RLS SELECT)
CREATE TABLE IF NOT EXISTS public.church_sms_gateways (
    church_id UUID PRIMARY KEY REFERENCES public.churches(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT true,
    api_url TEXT NOT NULL DEFAULT 'https://api.sms-gate.app/3rdparty/v1',
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    device_id TEXT,
    sim_number SMALLINT CHECK (sim_number IN (1, 2)),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_by UUID REFERENCES auth.users(id)
);

-- 21. EXPENSE CATEGORIES (Per-church outgoing expense classifications)
CREATE TABLE IF NOT EXISTS public.expense_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX IF NOT EXISTS idx_expense_categories_church
    ON public.expense_categories(church_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_categories_church_name
    ON public.expense_categories (church_id, lower(trim(name)));

-- 22. EXPENSES (Outgoing church payments; soft-delete only via RPCs)
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE RESTRICT,
    expense_date DATE NOT NULL,
    category_id UUID NOT NULL REFERENCES public.expense_categories(id) ON DELETE RESTRICT,
    paid_from_account_id UUID NOT NULL REFERENCES public.receiving_accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other')),
    payee_name TEXT NOT NULL CHECK (length(trim(payee_name)) > 0),
    bill_reference TEXT,
    notes TEXT,
    idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    created_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_by UUID REFERENCES auth.users(id),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES auth.users(id),
    deletion_reason TEXT,
    CONSTRAINT uq_expense_idempotency UNIQUE (church_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_expenses_church_date
    ON public.expenses(church_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_active
    ON public.expenses(church_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_category
    ON public.expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_account
    ON public.expenses(paid_from_account_id);

-- 23. EXPENSE REVISIONS (Append-only history of creations, corrections, and cancellations)
CREATE TABLE IF NOT EXISTS public.expense_revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE RESTRICT,
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE RESTRICT,
    revision_number INT NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('created', 'corrected', 'cancelled')),
    previous_snapshot JSONB,
    new_snapshot JSONB NOT NULL,
    actor_user_id UUID REFERENCES auth.users(id),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_expense_revision_seq UNIQUE (expense_id, revision_number)
);
CREATE INDEX IF NOT EXISTS idx_expense_revisions_expense
    ON public.expense_revisions(expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_revisions_church
    ON public.expense_revisions(church_id, created_at DESC);

-- ==============================================================================
-- SECTION 2: AUTH USER PROFILE TRIGGER
-- Automatically creates a public.profiles row whenever an auth.users account is created
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_full_name TEXT;
BEGIN
    v_full_name := COALESCE(
        NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
        NULLIF(trim(NEW.raw_user_meta_data ->> 'name'), ''),
        NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
        'User'
    );

    INSERT INTO public.profiles (id, email, full_name, phone)
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        v_full_name,
        NULLIF(trim(COALESCE(NEW.raw_user_meta_data ->> 'phone', '')), '')
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        full_name = CASE
            WHEN length(trim(COALESCE(public.profiles.full_name, ''))) = 0 THEN EXCLUDED.full_name
            ELSE public.profiles.full_name
        END,
        updated_at = timezone('utc'::text, now());

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Church slug normalization trigger on insert/update
CREATE OR REPLACE FUNCTION public.normalize_church_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_source TEXT;
BEGIN
    v_source := COALESCE(NULLIF(trim(NEW.slug), ''), NULLIF(trim(NEW.code), ''), trim(NEW.name));
    NEW.slug := trim(both '-' from regexp_replace(lower(COALESCE(v_source, '')), '[^a-z0-9]+', '-', 'g'));

    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := timezone('utc'::text, now());
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_church_slug ON public.churches;
CREATE TRIGGER trg_normalize_church_slug
    BEFORE INSERT OR UPDATE ON public.churches
    FOR EACH ROW EXECUTE FUNCTION public.normalize_church_slug();

-- Live slug availability check RPC for admins & accountants
CREATE OR REPLACE FUNCTION public.check_church_slug_availability(
    p_slug TEXT,
    p_exclude_church_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_clean TEXT;
    v_exists BOOLEAN;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_clean := trim(both '-' from regexp_replace(lower(COALESCE(p_slug, '')), '[^a-z0-9]+', '-', 'g'));

    IF length(v_clean) < 2 OR length(v_clean) > 64 OR v_clean !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
        RETURN jsonb_build_object(
            'available', false,
            'normalized_slug', v_clean,
            'reason', 'Slug must be 2–64 characters using lowercase letters, numbers, and hyphens only.'
        );
    END IF;

    IF v_clean = ANY(ARRAY[
        'home',
        'privacy',
        'privacy-policy',
        'terms',
        'terms-of-service',
        'member-portal',
        'api',
        'auth',
        'login',
        'c',
        'assets',
        'favicon-ico',
        'robots-txt'
    ]) THEN
        RETURN jsonb_build_object(
            'available', false,
            'normalized_slug', v_clean,
            'reason', '"' || v_clean || '" is a reserved application route. Please choose another slug.'
        );
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.churches c
        WHERE lower(c.slug) = v_clean
          AND (p_exclude_church_id IS NULL OR c.id <> p_exclude_church_id)
    ) INTO v_exists;

    RETURN jsonb_build_object(
        'available', NOT v_exists,
        'normalized_slug', v_clean,
        'reason', CASE WHEN v_exists THEN 'This URL slug is already in use by another church.' ELSE NULL END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_church_slug_availability(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_church_slug_availability(TEXT, UUID) TO authenticated;

-- Normalize & validate church fields on INSERT and lock churches.code once members exist
CREATE OR REPLACE FUNCTION public.guard_church_code_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_phone TEXT;
BEGIN
    NEW.code := upper(trim(COALESCE(NEW.code, '')));

    IF length(NEW.code) = 0 THEN
        RAISE EXCEPTION 'Church code cannot be empty.';
    END IF;

    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM upper(trim(OLD.code))) THEN
        IF length(NEW.code) < 2 OR length(NEW.code) > 20 OR NEW.code !~ '^[A-Z0-9]+(?:-[A-Z0-9]+)*$' THEN
            RAISE EXCEPTION 'Church code must be 2–20 characters using uppercase letters, numbers, and single inner hyphens (-) only.';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM upper(trim(OLD.code)) THEN
        IF EXISTS (
            SELECT 1
            FROM public.members m
            WHERE m.church_id = OLD.id
        ) THEN
            RAISE EXCEPTION 'Church code (%) is locked and cannot be changed after members exist.', OLD.code;
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.name := trim(COALESCE(NEW.name, ''));
        IF length(NEW.name) = 0 THEN
            RAISE EXCEPTION 'Church name is required.';
        END IF;

        NEW.address := trim(COALESCE(NEW.address, ''));
        IF length(NEW.address) = 0 THEN
            RAISE EXCEPTION 'Church address is required.';
        END IF;

        v_clean_phone := regexp_replace(trim(COALESCE(NEW.phone, '')), '[\s\-()]', '', 'g');
        IF v_clean_phone ~ '^\+91[0-9]{10}$' THEN
            v_clean_phone := substr(v_clean_phone, 4);
        ELSIF v_clean_phone ~ '^91[0-9]{10}$' THEN
            v_clean_phone := substr(v_clean_phone, 3);
        ELSIF v_clean_phone ~ '^0[0-9]{10}$' THEN
            v_clean_phone := substr(v_clean_phone, 2);
        END IF;

        IF v_clean_phone !~ '^[6-9][0-9]{9}$' OR v_clean_phone ~ '^([0-9])\1{9}$' THEN
            RAISE EXCEPTION 'Church phone must be a valid 10-digit Indian mobile number.';
        END IF;
        NEW.phone := v_clean_phone;

        NEW.email := lower(trim(COALESCE(NEW.email, '')));
        IF length(NEW.email) = 0 OR NEW.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
            RAISE EXCEPTION 'A valid church email address is required.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_church_code_change ON public.churches;
CREATE TRIGGER trg_guard_church_code_change
    BEFORE INSERT OR UPDATE ON public.churches
    FOR EACH ROW EXECUTE FUNCTION public.guard_church_code_change();

-- Sequential <UPPER_CHURCH_CODE>-<N> generator (starts at 1; preserves existing M-0001 rows)
CREATE OR REPLACE FUNCTION public.generate_next_church_member_number(
    p_church_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_church_code TEXT;
    v_prefix TEXT;
    v_prefix_len INT;
    v_next_seq BIGINT;
BEGIN
    IF p_church_id IS NULL THEN
        RAISE EXCEPTION 'Church ID is required to generate member number.';
    END IF;

    SELECT upper(trim(code))
    INTO v_church_code
    FROM public.churches
    WHERE id = p_church_id
    FOR UPDATE;

    IF v_church_code IS NULL OR length(v_church_code) = 0 THEN
        RAISE EXCEPTION 'Church not found or missing church code.';
    END IF;

    v_prefix := v_church_code || '-';
    v_prefix_len := length(v_prefix);

    SELECT COALESCE(
        MAX(
            CASE
                WHEN upper(left(m.member_number, v_prefix_len)) = v_prefix
                 AND substr(m.member_number, v_prefix_len + 1) ~ '^[1-9][0-9]*$'
                THEN substr(m.member_number, v_prefix_len + 1)::BIGINT
                ELSE 0
            END
        ),
        0
    ) + 1
    INTO v_next_seq
    FROM public.members m
    WHERE m.church_id = p_church_id;

    WHILE EXISTS (
        SELECT 1
        FROM public.members m
        WHERE m.church_id = p_church_id
          AND upper(m.member_number) = upper(v_prefix || v_next_seq::TEXT)
    ) LOOP
        v_next_seq := v_next_seq + 1;
    END LOOP;

    RETURN v_prefix || v_next_seq::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_next_church_member_number(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_next_church_member_number(UUID) TO authenticated;

-- Authoritative BEFORE INSERT trigger on public.members (does NOT alter existing rows)
CREATE OR REPLACE FUNCTION public.assign_church_member_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.member_number := public.generate_next_church_member_number(NEW.church_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_church_member_number ON public.members;
CREATE TRIGGER trg_assign_church_member_number
    BEFORE INSERT ON public.members
    FOR EACH ROW EXECUTE FUNCTION public.assign_church_member_number();

-- ==============================================================================
-- SECTION 3: ENABLE ROW LEVEL SECURITY (RLS) ON ALL 22 TABLES
-- ==============================================================================

ALTER TABLE public.churches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receiving_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_sms_gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_revisions ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- SECTION 4: SECURITY HELPER FUNCTIONS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id
    );
$$;

-- Deterministic highest-privilege role lookup per user & church
CREATE OR REPLACE FUNCTION public.get_auth_church_role(p_church_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT role
    FROM public.church_access
    WHERE church_id = p_church_id
      AND user_id = p_user_id
      AND status = 'approved'
    ORDER BY CASE role
        WHEN 'admin' THEN 1
        WHEN 'accountant' THEN 2
        WHEN 'collector' THEN 3
        WHEN 'member' THEN 4
        ELSE 5
    END
    LIMIT 1;
$$;

-- ==============================================================================
-- SECTION 5: RLS POLICIES
-- Note: notification_attempts and report_exports
-- intentionally have ZERO direct client policies (accessed only via SECURITY DEFINER RPCs / service role).
-- ==============================================================================

-- 1. PROFILES RLS
DROP POLICY IF EXISTS "Users can read their own profile" ON public.profiles;
CREATE POLICY "Users can read their own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile basic info" ON public.profiles;
CREATE POLICY "Users can update their own profile basic info"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- 2. PLATFORM ADMINS RLS
DROP POLICY IF EXISTS "Users can check their own platform admin status" ON public.platform_admins;
CREATE POLICY "Users can check their own platform admin status"
    ON public.platform_admins FOR SELECT
    USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()));

-- 3. CHURCHES RLS
DROP POLICY IF EXISTS "Public/authenticated can see active churches for selection" ON public.churches;
CREATE POLICY "Public/authenticated can see active churches for selection"
    ON public.churches FOR SELECT
    USING (is_active = true OR public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Platform admins can manage churches" ON public.churches;
CREATE POLICY "Platform admins can manage churches"
    ON public.churches FOR ALL
    USING (public.is_platform_admin(auth.uid()))
    WITH CHECK (public.is_platform_admin(auth.uid()));

DROP POLICY IF EXISTS "Church admins and accountants can update church settings" ON public.churches;
CREATE POLICY "Church admins and accountants can update church settings"
    ON public.churches FOR UPDATE
    USING (public.get_auth_church_role(id, auth.uid()) IN ('admin', 'accountant'))
    WITH CHECK (public.get_auth_church_role(id, auth.uid()) IN ('admin', 'accountant'));

-- 4. CHURCH ACCESS RLS
DROP POLICY IF EXISTS "Users can view their own church access assignments" ON public.church_access;
CREATE POLICY "Users can view their own church access assignments"
    ON public.church_access FOR SELECT
    USING (
        user_id = auth.uid()
        OR public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- 5. MEMBERS RLS
DROP POLICY IF EXISTS "Staff can view members in their church" ON public.members;
CREATE POLICY "Staff can view members in their church"
    ON public.members FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
        OR id IN (SELECT member_id FROM public.member_account_links WHERE user_id = auth.uid() AND church_id = members.church_id)
    );

DROP POLICY IF EXISTS "Staff can create members in their church" ON public.members;
CREATE POLICY "Staff can create members in their church"
    ON public.members FOR INSERT
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
    );

DROP POLICY IF EXISTS "Staff can update members in their church" ON public.members;
CREATE POLICY "Staff can update members in their church"
    ON public.members FOR UPDATE
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
    )
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
    );

-- 6. MEMBER ACCOUNT LINKS RLS
DROP POLICY IF EXISTS "Users and church staff can read member account links" ON public.member_account_links;
CREATE POLICY "Users and church staff can read member account links"
    ON public.member_account_links FOR SELECT
    USING (
        user_id = auth.uid()
        OR public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- 7. ACCESS REQUESTS RLS
DROP POLICY IF EXISTS "Applicants can read own access requests" ON public.access_requests;
CREATE POLICY "Applicants can read own access requests"
    ON public.access_requests FOR SELECT
    USING (
        user_id = auth.uid()
        OR public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

DROP POLICY IF EXISTS "Applicants can update own draft or returned requests" ON public.access_requests;
CREATE POLICY "Applicants can update own draft or returned requests"
    ON public.access_requests FOR UPDATE
    USING (user_id = auth.uid() AND status IN ('draft', 'returned_for_correction'));

DROP POLICY IF EXISTS "Church admins and accountants can update access requests" ON public.access_requests;
CREATE POLICY "Church admins and accountants can update access requests"
    ON public.access_requests FOR UPDATE
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    )
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- 8. DONATION CATEGORIES RLS
DROP POLICY IF EXISTS "Church members and staff can view donation categories" ON public.donation_categories;
CREATE POLICY "Church members and staff can view donation categories"
    ON public.donation_categories FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector', 'member')
    );

DROP POLICY IF EXISTS "Church admins and accountants can manage donation categories" ON public.donation_categories;
CREATE POLICY "Church admins and accountants can manage donation categories"
    ON public.donation_categories FOR INSERT
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

DROP POLICY IF EXISTS "Church admins and accountants can update donation categories" ON public.donation_categories;
CREATE POLICY "Church admins and accountants can update donation categories"
    ON public.donation_categories FOR UPDATE
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    )
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- 9. RECEIVING ACCOUNTS RLS
DROP POLICY IF EXISTS "Church members and staff can view receiving accounts" ON public.receiving_accounts;
CREATE POLICY "Church members and staff can view receiving accounts"
    ON public.receiving_accounts FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector', 'member')
    );

DROP POLICY IF EXISTS "Church admins and accountants can manage receiving accounts" ON public.receiving_accounts;
CREATE POLICY "Church admins and accountants can manage receiving accounts"
    ON public.receiving_accounts FOR INSERT
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

DROP POLICY IF EXISTS "Church admins and accountants can update receiving accounts" ON public.receiving_accounts;
CREATE POLICY "Church admins and accountants can update receiving accounts"
    ON public.receiving_accounts FOR UPDATE
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    )
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

GRANT SELECT, INSERT, UPDATE ON public.donation_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.receiving_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.expense_categories TO authenticated;

-- 10. DONATIONS RLS (Reads only; writes strictly via SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "Staff can view church donations; members can view only their own" ON public.donations;
CREATE POLICY "Staff can view church donations; members can view only their own"
    ON public.donations FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
        OR (
            public.get_auth_church_role(church_id, auth.uid()) = 'member'
            AND member_id IN (SELECT member_id FROM public.member_account_links WHERE user_id = auth.uid() AND church_id = donations.church_id)
            AND deleted_at IS NULL
        )
    );

-- 11. DONATION REVISIONS RLS (Append-only; readable by church staff)
DROP POLICY IF EXISTS "Church staff can view donation revisions" ON public.donation_revisions;
CREATE POLICY "Church staff can view donation revisions"
    ON public.donation_revisions FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
    );

-- 12. AUDIT LOGS RLS (Append-only; viewable by Admin and Accountant)
DROP POLICY IF EXISTS "Audits viewable by Admin and Accountant only" ON public.audit_logs;
CREATE POLICY "Audits viewable by Admin and Accountant only"
    ON public.audit_logs FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR (church_id IS NOT NULL AND public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant'))
    );

-- 13. CHURCH SETTINGS RLS
DROP POLICY IF EXISTS "Church members and staff can view church settings" ON public.church_settings;
CREATE POLICY "Church members and staff can view church settings"
    ON public.church_settings FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector', 'member')
    );

DROP POLICY IF EXISTS "Church admins and accountants can insert church settings" ON public.church_settings;
CREATE POLICY "Church admins and accountants can insert church settings"
    ON public.church_settings FOR INSERT
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

DROP POLICY IF EXISTS "Church admins and accountants can update church settings" ON public.church_settings;
CREATE POLICY "Church admins and accountants can update church settings"
    ON public.church_settings FOR UPDATE
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    )
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- 14. NOTIFICATIONS RLS
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
    ON public.notifications FOR SELECT
    USING (recipient_user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
    ON public.notifications FOR UPDATE
    USING (recipient_user_id = auth.uid())
    WITH CHECK (recipient_user_id = auth.uid());

-- 15. NOTIFICATION JOBS RLS
DROP POLICY IF EXISTS "Church staff can view notification jobs" ON public.notification_jobs;
CREATE POLICY "Church staff can view notification jobs"
    ON public.notification_jobs FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
    );

DROP POLICY IF EXISTS "Church staff can update notification jobs" ON public.notification_jobs;
CREATE POLICY "Church staff can update notification jobs"
    ON public.notification_jobs FOR UPDATE
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
    )
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
    );

-- 16. MEMBER SHARE LINKS RLS (Staff can view link status metadata; writes strictly via SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "Church staff can view member share links" ON public.member_share_links;
CREATE POLICY "Church staff can view member share links"
    ON public.member_share_links FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
    );

-- 17. EXPENSE CATEGORIES RLS (Strictly Admin & Accountant; Collectors and Members blocked)
DROP POLICY IF EXISTS "Church admins and accountants can view expense categories" ON public.expense_categories;
CREATE POLICY "Church admins and accountants can view expense categories"
    ON public.expense_categories FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

DROP POLICY IF EXISTS "Church admins and accountants can insert expense categories" ON public.expense_categories;
CREATE POLICY "Church admins and accountants can insert expense categories"
    ON public.expense_categories FOR INSERT
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

DROP POLICY IF EXISTS "Church admins and accountants can update expense categories" ON public.expense_categories;
CREATE POLICY "Church admins and accountants can update expense categories"
    ON public.expense_categories FOR UPDATE
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    )
    WITH CHECK (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- 18. EXPENSES RLS (Reads strictly Admin & Accountant; writes strictly via SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "Church admins and accountants can view expenses" ON public.expenses;
CREATE POLICY "Church admins and accountants can view expenses"
    ON public.expenses FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- 19. EXPENSE REVISIONS RLS (Append-only; readable strictly by Admin & Accountant; writes strictly via SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "Church admins and accountants can view expense revisions" ON public.expense_revisions;
CREATE POLICY "Church admins and accountants can view expense revisions"
    ON public.expense_revisions FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

GRANT SELECT ON public.expenses TO authenticated;
GRANT SELECT ON public.expense_revisions TO authenticated;

-- ==============================================================================
-- SECTION 6: ATOMIC BUSINESS & SECURITY DEFINER RPCS
-- ==============================================================================

-- 0. AUTOMATIC RECEIPT PREFIX & AVAILABILITY CHECK HELPERS
CREATE OR REPLACE FUNCTION public.compute_church_fy_code(
    p_donation_date DATE
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_month INT;
    v_year INT;
    v_start_year INT;
BEGIN
    IF p_donation_date IS NULL THEN
        RAISE EXCEPTION 'Donation date is required to determine financial year.';
    END IF;

    v_month := EXTRACT(MONTH FROM p_donation_date)::INT;
    v_year := EXTRACT(YEAR FROM p_donation_date)::INT;
    v_start_year := CASE WHEN v_month >= 4 THEN v_year ELSE v_year - 1 END;

    RETURN v_start_year::TEXT || '-' || right((v_start_year + 1)::TEXT, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_auto_receipt_number(
    p_church_code TEXT,
    p_donation_date DATE,
    p_receipt_input TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_clean_code TEXT := upper(trim(COALESCE(p_church_code, '')));
    v_fy_code TEXT;
    v_expected_prefix TEXT;
    v_raw TEXT := trim(COALESCE(p_receipt_input, ''));
    v_digits TEXT;
    v_clean_digits TEXT;
BEGIN
    IF length(v_clean_code) = 0 THEN
        RAISE EXCEPTION 'Church code is required to generate receipt prefix.';
    END IF;

    v_fy_code := public.compute_church_fy_code(p_donation_date);
    v_expected_prefix := v_clean_code || '/' || v_fy_code || '/';

    IF strpos(v_raw, '/') > 0 THEN
        IF lower(left(v_raw, length(v_expected_prefix))) = lower(v_expected_prefix) THEN
            v_digits := substr(v_raw, length(v_expected_prefix) + 1);
        ELSE
            RAISE EXCEPTION 'Receipt prefix is locked to "%" based on church code and donation date.', v_expected_prefix;
        END IF;
    ELSE
        v_digits := v_raw;
    END IF;

    IF v_digits !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'Receipt number must contain positive numeric digits only.';
    END IF;

    IF length(v_digits) > 20 THEN
        RAISE EXCEPTION 'Receipt number cannot exceed 20 digits.';
    END IF;

    v_clean_digits := regexp_replace(v_digits, '^0+', '');
    IF v_clean_digits = '' THEN
        RAISE EXCEPTION 'Receipt number must be greater than zero.';
    END IF;

    RETURN v_expected_prefix || v_clean_digits;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_receipt_number_availability(
    p_church_id UUID,
    p_donation_date DATE,
    p_receipt_number TEXT,
    p_exclude_donation_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_church_code TEXT;
    v_canonical TEXT;
    v_normalized TEXT;
    v_existing_count INT := 0;
    v_existing_total NUMERIC(14, 2) := 0;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant', 'collector') THEN
        RAISE EXCEPTION 'Unauthorized: You do not have permission to verify receipt availability.';
    END IF;

    SELECT code INTO v_church_code
    FROM public.churches
    WHERE id = p_church_id;

    IF v_church_code IS NULL THEN
        RAISE EXCEPTION 'Church not found.';
    END IF;

    v_canonical := public.normalize_auto_receipt_number(v_church_code, p_donation_date, p_receipt_number);
    v_normalized := lower(trim(v_canonical));

    SELECT
        COUNT(*)::INT,
        COALESCE(SUM(d.amount), 0)::NUMERIC(14, 2)
    INTO v_existing_count, v_existing_total
    FROM public.donations d
    WHERE d.church_id = p_church_id
      AND d.deleted_at IS NULL
      AND lower(trim(d.receipt_number)) = v_normalized
      AND (
          p_exclude_donation_id IS NULL
          OR d.id <> p_exclude_donation_id
      );

    RETURN jsonb_build_object(
        'available', true,
        'is_shared', v_existing_count > 0,
        'existing_count', v_existing_count,
        'existing_total', v_existing_total,
        'formatted_receipt', v_canonical
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_receipt_number_availability(UUID, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_receipt_number_availability(UUID, DATE, TEXT, UUID) TO authenticated;

-- 1. RECORD DONATION (Atomic transaction with auto church-code + FY prefix; shared receipt numbers permitted)
CREATE OR REPLACE FUNCTION public.record_donation(
    p_church_id UUID,
    p_member_id UUID,
    p_receipt_number TEXT,
    p_donation_date DATE,
    p_category_id UUID,
    p_amount NUMERIC(14, 2),
    p_receiving_account_id UUID,
    p_payment_method TEXT,
    p_payment_reference TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_canonical_receipt TEXT;
    v_existing_donation_id UUID;
    v_donation_id UUID;
    v_new_donation RECORD;
    v_member_church_id UUID;
    v_cat_church_id UUID;
    v_acc_church_id UUID;
    v_cat_active BOOLEAN;
    v_acc_active BOOLEAN;
    v_member_name TEXT;
    v_church_name TEXT;
    v_church_code TEXT;
    v_cat_name TEXT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant', 'collector') THEN
        RAISE EXCEPTION 'Unauthorized: You do not have permission to record donations for this church.';
    END IF;

    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        SELECT id INTO v_existing_donation_id
        FROM public.donations
        WHERE church_id = p_church_id AND idempotency_key = p_idempotency_key;

        IF v_existing_donation_id IS NOT NULL THEN
            SELECT * INTO v_new_donation FROM public.donations WHERE id = v_existing_donation_id;
            RETURN to_jsonb(v_new_donation);
        END IF;
    END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Donation amount must be greater than zero.';
    END IF;

    SELECT name, code INTO v_church_name, v_church_code
    FROM public.churches
    WHERE id = p_church_id;

    IF v_church_code IS NULL THEN
        RAISE EXCEPTION 'Church not found.';
    END IF;

    v_canonical_receipt := public.normalize_auto_receipt_number(v_church_code, p_donation_date, p_receipt_number);

    SELECT church_id, full_name INTO v_member_church_id, v_member_name
    FROM public.members WHERE id = p_member_id;

    IF v_member_church_id IS NULL OR v_member_church_id <> p_church_id THEN
        RAISE EXCEPTION 'Invalid member: Member does not belong to this church.';
    END IF;

    SELECT church_id, is_active, name INTO v_cat_church_id, v_cat_active, v_cat_name
    FROM public.donation_categories WHERE id = p_category_id;

    IF v_cat_church_id IS NULL OR v_cat_church_id <> p_church_id THEN
        RAISE EXCEPTION 'Invalid category: Category does not belong to this church.';
    END IF;
    IF NOT v_cat_active THEN
        RAISE EXCEPTION 'Selected donation category is inactive.';
    END IF;

    SELECT church_id, is_active INTO v_acc_church_id, v_acc_active
    FROM public.receiving_accounts WHERE id = p_receiving_account_id;

    IF v_acc_church_id IS NULL OR v_acc_church_id <> p_church_id THEN
        RAISE EXCEPTION 'Invalid receiving account: Account does not belong to this church.';
    END IF;
    IF NOT v_acc_active THEN
        RAISE EXCEPTION 'Selected receiving account is inactive.';
    END IF;

    INSERT INTO public.donations (
        church_id,
        member_id,
        receipt_number,
        donation_date,
        category_id,
        amount,
        receiving_account_id,
        payment_method,
        payment_reference,
        notes,
        idempotency_key,
        created_by,
        updated_by
    ) VALUES (
        p_church_id,
        p_member_id,
        v_canonical_receipt,
        p_donation_date,
        p_category_id,
        p_amount,
        p_receiving_account_id,
        p_payment_method,
        trim(p_payment_reference),
        trim(p_notes),
        NULLIF(trim(COALESCE(p_idempotency_key, '')), ''),
        v_actor_id,
        v_actor_id
    )
    RETURNING id INTO v_donation_id;

    SELECT * INTO v_new_donation FROM public.donations WHERE id = v_donation_id;

    INSERT INTO public.donation_revisions (
        donation_id,
        church_id,
        revision_number,
        change_type,
        previous_snapshot,
        new_snapshot,
        actor_user_id,
        reason
    ) VALUES (
        v_donation_id,
        p_church_id,
        1,
        'created',
        NULL,
        to_jsonb(v_new_donation),
        v_actor_id,
        'Initial donation entry'
    );

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state,
        reason
    ) VALUES (
        p_church_id,
        v_actor_id,
        'donation.created',
        'donation',
        v_donation_id::text,
        'Recorded donation of INR ' || p_amount || ' with receipt ' || v_canonical_receipt,
        NULL,
        to_jsonb(v_new_donation),
        'Donation recorded'
    );

    RETURN to_jsonb(v_new_donation);
END;
$$;

-- 2. CORRECT DONATION (Admin or Accountant only; Collectors blocked)
CREATE OR REPLACE FUNCTION public.correct_donation(
    p_donation_id UUID,
    p_new_receipt_number TEXT,
    p_new_amount NUMERIC(14, 2),
    p_new_category_id UUID,
    p_new_receiving_account_id UUID,
    p_new_donation_date DATE,
    p_new_payment_method TEXT,
    p_new_payment_reference TEXT,
    p_new_notes TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_old_donation RECORD;
    v_new_donation RECORD;
    v_church_id UUID;
    v_church_code TEXT;
    v_role TEXT;
    v_cat_church_id UUID;
    v_acc_church_id UUID;
    v_next_revision INT;
    v_new_canonical_receipt TEXT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'A clear reason is required to correct a saved donation.';
    END IF;

    IF p_new_amount <= 0 THEN
        RAISE EXCEPTION 'Donation amount must be greater than zero.';
    END IF;

    SELECT * INTO v_old_donation FROM public.donations WHERE id = p_donation_id;
    IF v_old_donation.id IS NULL THEN
        RAISE EXCEPTION 'Donation not found.';
    END IF;
    IF v_old_donation.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot edit a cancelled donation.';
    END IF;

    v_church_id := v_old_donation.church_id;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(v_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Collectors and Members cannot edit saved donations.';
    END IF;

    SELECT code INTO v_church_code FROM public.churches WHERE id = v_church_id;
    IF v_church_code IS NULL THEN
        RAISE EXCEPTION 'Church not found.';
    END IF;

    SELECT church_id INTO v_cat_church_id
    FROM public.donation_categories WHERE id = p_new_category_id;
    IF v_cat_church_id IS NULL OR v_cat_church_id <> v_church_id THEN
        RAISE EXCEPTION 'Invalid category: Category does not belong to this church.';
    END IF;

    SELECT church_id INTO v_acc_church_id
    FROM public.receiving_accounts WHERE id = p_new_receiving_account_id;
    IF v_acc_church_id IS NULL OR v_acc_church_id <> v_church_id THEN
        RAISE EXCEPTION 'Invalid receiving account: Account does not belong to this church.';
    END IF;

    v_new_canonical_receipt := public.normalize_auto_receipt_number(v_church_code, p_new_donation_date, p_new_receipt_number);

    UPDATE public.donations
    SET
        receipt_number = v_new_canonical_receipt,
        amount = p_new_amount,
        category_id = p_new_category_id,
        receiving_account_id = p_new_receiving_account_id,
        donation_date = p_new_donation_date,
        payment_method = p_new_payment_method,
        payment_reference = trim(p_new_payment_reference),
        notes = trim(p_new_notes),
        updated_at = timezone('utc'::text, now()),
        updated_by = v_actor_id
    WHERE id = p_donation_id
    RETURNING * INTO v_new_donation;

    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_revision
    FROM public.donation_revisions WHERE donation_id = p_donation_id;

    INSERT INTO public.donation_revisions (
        donation_id,
        church_id,
        revision_number,
        change_type,
        previous_snapshot,
        new_snapshot,
        actor_user_id,
        reason
    ) VALUES (
        p_donation_id,
        v_church_id,
        v_next_revision,
        'corrected',
        to_jsonb(v_old_donation),
        to_jsonb(v_new_donation),
        v_actor_id,
        trim(p_reason)
    );

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state,
        reason
    ) VALUES (
        v_church_id,
        v_actor_id,
        'donation.corrected',
        'donation',
        p_donation_id::text,
        'Corrected donation ' || p_donation_id::text,
        to_jsonb(v_old_donation),
        to_jsonb(v_new_donation),
        trim(p_reason)
    );

    RETURN to_jsonb(v_new_donation);
END;
$$;

-- 3. CANCEL / SOFT-DELETE DONATION (Admin or Accountant only; frees receipt number for reuse)
CREATE OR REPLACE FUNCTION public.cancel_donation(
    p_donation_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_old_donation RECORD;
    v_new_donation RECORD;
    v_church_id UUID;
    v_role TEXT;
    v_next_revision INT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'A clear reason is required to cancel a donation.';
    END IF;

    SELECT * INTO v_old_donation FROM public.donations WHERE id = p_donation_id;
    IF v_old_donation.id IS NULL THEN
        RAISE EXCEPTION 'Donation not found.';
    END IF;
    IF v_old_donation.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Donation is already cancelled.';
    END IF;

    v_church_id := v_old_donation.church_id;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(v_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Only Admin or Accountant can cancel donations.';
    END IF;

    UPDATE public.donations
    SET
        deleted_at = timezone('utc'::text, now()),
        deleted_by = v_actor_id,
        deletion_reason = trim(p_reason)
    WHERE id = p_donation_id
    RETURNING * INTO v_new_donation;

    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_revision
    FROM public.donation_revisions WHERE donation_id = p_donation_id;

    INSERT INTO public.donation_revisions (
        donation_id,
        church_id,
        revision_number,
        change_type,
        previous_snapshot,
        new_snapshot,
        actor_user_id,
        reason
    ) VALUES (
        p_donation_id,
        v_church_id,
        v_next_revision,
        'cancelled',
        to_jsonb(v_old_donation),
        to_jsonb(v_new_donation),
        v_actor_id,
        trim(p_reason)
    );

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state,
        reason
    ) VALUES (
        v_church_id,
        v_actor_id,
        'donation.cancelled',
        'donation',
        p_donation_id::text,
        'Cancelled donation with receipt ' || v_old_donation.receipt_number,
        to_jsonb(v_old_donation),
        to_jsonb(v_new_donation),
        trim(p_reason)
    );

    RETURN to_jsonb(v_new_donation);
END;
$$;

-- 4. CHANGE MEMBER STATUS (Church Admin, Platform Admin, or Accountant)
CREATE OR REPLACE FUNCTION public.change_member_status(
    p_church_id UUID,
    p_member_id UUID,
    p_new_status TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_old_member RECORD;
    v_new_member RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
    END IF;

    IF v_role IS NULL OR v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Only Church Admins, Platform Admins, and Accountants may change membership status.';
    END IF;

    IF p_new_status NOT IN ('active', 'inactive') THEN
        RAISE EXCEPTION 'Invalid membership status. Allowed values: active, inactive.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'A clear reason is required to change membership status.';
    END IF;

    SELECT * INTO v_old_member FROM public.members
    WHERE id = p_member_id AND church_id = p_church_id;

    IF v_old_member.id IS NULL THEN
        RAISE EXCEPTION 'Member not found in this church.';
    END IF;

    IF v_old_member.membership_status = p_new_status THEN
        RAISE EXCEPTION 'Member is already %.', p_new_status;
    END IF;

    UPDATE public.members
    SET
        membership_status = p_new_status,
        updated_at = timezone('utc'::text, now()),
        updated_by = v_actor_id
    WHERE id = p_member_id
    RETURNING * INTO v_new_member;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state,
        reason
    ) VALUES (
        p_church_id,
        v_actor_id,
        'member.status_changed',
        'member',
        p_member_id::text,
        'Changed member status from ' || v_old_member.membership_status || ' to ' || p_new_status,
        jsonb_build_object('membership_status', v_old_member.membership_status),
        jsonb_build_object('membership_status', p_new_status),
        trim(p_reason)
    );

    RETURN to_jsonb(v_new_member);
END;
$$;

-- 5. SUBMIT PROFILE REQUEST (Google OAuth Onboarding + Indian 10-digit mobile validation)
CREATE OR REPLACE FUNCTION public.submit_profile_request(
    p_church_id UUID,
    p_full_name TEXT,
    p_date_of_birth DATE,
    p_phone TEXT,
    p_gender TEXT,
    p_village_name TEXT,
    p_is_draft BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_user_email TEXT;
    v_existing RECORD;
    v_status TEXT;
    v_version INT := 1;
    v_request_id UUID;
    v_church_active BOOLEAN;
    v_clean_phone TEXT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT email INTO v_user_email FROM auth.users WHERE id = v_actor_id;
    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'Authenticated user identity not found.';
    END IF;

    SELECT is_active INTO v_church_active FROM public.churches WHERE id = p_church_id;
    IF v_church_active IS NULL OR NOT v_church_active THEN
        RAISE EXCEPTION 'Selected church does not exist or is inactive.';
    END IF;

    v_clean_phone := NULLIF(regexp_replace(trim(COALESCE(p_phone, '')), '[\s\-()]', '', 'g'), '');
    IF v_clean_phone IS NOT NULL THEN
        IF v_clean_phone ~ '^\+91[0-9]{10}$' THEN
            v_clean_phone := substr(v_clean_phone, 4);
        ELSIF v_clean_phone ~ '^91[0-9]{10}$' THEN
            v_clean_phone := substr(v_clean_phone, 3);
        ELSIF v_clean_phone ~ '^0[0-9]{10}$' THEN
            v_clean_phone := substr(v_clean_phone, 2);
        END IF;
    END IF;

    IF NOT p_is_draft THEN
        IF p_full_name IS NULL OR length(trim(p_full_name)) = 0 THEN
            RAISE EXCEPTION 'Full name is required.';
        END IF;

        IF p_date_of_birth IS NULL THEN
            RAISE EXCEPTION 'Date of birth is required.';
        END IF;

        IF p_date_of_birth > CURRENT_DATE THEN
            RAISE EXCEPTION 'Date of birth cannot be in the future.';
        END IF;

        IF p_date_of_birth < (CURRENT_DATE - INTERVAL '150 years') THEN
            RAISE EXCEPTION 'Please enter a valid date of birth.';
        END IF;

        IF v_clean_phone IS NULL OR v_clean_phone !~ '^[6-9][0-9]{9}$' OR v_clean_phone ~ '^([0-9])\1{9}$' THEN
            RAISE EXCEPTION 'Please enter a valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9).';
        END IF;

        IF p_gender IS NULL OR p_gender NOT IN ('male', 'female', 'other', 'prefer_not_to_say') THEN
            RAISE EXCEPTION 'Explicit gender selection is required.';
        END IF;

        IF p_village_name IS NULL OR length(trim(p_village_name)) = 0 THEN
            RAISE EXCEPTION 'Village / City Name is required.';
        END IF;

        v_status := 'pending';
    ELSE
        v_status := 'draft';
    END IF;

    SELECT * INTO v_existing
    FROM public.access_requests
    WHERE church_id = p_church_id AND user_id = v_actor_id AND status IN ('draft', 'pending', 'returned_for_correction')
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        v_version := v_existing.submission_version + 1;

        UPDATE public.access_requests
        SET
            applicant_name = trim(p_full_name),
            applicant_email = v_user_email,
            applicant_phone = v_clean_phone,
            date_of_birth = p_date_of_birth,
            gender = p_gender,
            village_name = trim(p_village_name),
            is_draft = p_is_draft,
            status = v_status,
            submission_version = v_version,
            requested_at = timezone('utc'::text, now()),
            decision_reason = NULL
        WHERE id = v_existing.id
        RETURNING id INTO v_request_id;
    ELSE
        INSERT INTO public.access_requests (
            church_id,
            user_id,
            applicant_name,
            applicant_email,
            applicant_phone,
            date_of_birth,
            gender,
            village_name,
            is_draft,
            status,
            submission_version,
            requested_at
        ) VALUES (
            p_church_id,
            v_actor_id,
            trim(p_full_name),
            v_user_email,
            v_clean_phone,
            p_date_of_birth,
            p_gender,
            trim(p_village_name),
            p_is_draft,
            v_status,
            1,
            timezone('utc'::text, now())
        )
        RETURNING id INTO v_request_id;
    END IF;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        new_state,
        reason
    ) VALUES (
        p_church_id,
        v_actor_id,
        CASE WHEN p_is_draft THEN 'access_request.draft_saved' ELSE 'access_request.submitted' END,
        'access_request',
        v_request_id::text,
        CASE WHEN p_is_draft THEN 'Saved onboarding profile draft' ELSE 'Submitted onboarding profile (version ' || v_version || ')' END,
        jsonb_build_object(
            'status', v_status,
            'version', v_version,
            'is_draft', p_is_draft,
            'village_name', trim(p_village_name)
        ),
        'User onboarding'
    );

    RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'status', v_status, 'version', v_version);
END;
$$;

-- 6. APPROVE ACCESS REQUEST (Legacy signature preserved)
CREATE OR REPLACE FUNCTION public.approve_access_request(
    p_request_id UUID,
    p_member_id UUID,
    p_create_member_name TEXT DEFAULT NULL,
    p_village_name TEXT DEFAULT NULL,
    p_gender TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_req RECORD;
    v_final_member_id UUID;
    v_has_accountant_role BOOLEAN;
    v_member_number TEXT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_req FROM public.access_requests WHERE id = p_request_id;
    IF v_req.id IS NULL THEN
        RAISE EXCEPTION 'Access request not found.';
    END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Request is already resolved.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.church_access
        WHERE church_id = v_req.church_id AND user_id = v_actor_id AND role = 'accountant' AND status = 'approved'
    ) INTO v_has_accountant_role;

    IF NOT v_has_accountant_role AND NOT public.is_platform_admin(v_actor_id) THEN
        RAISE EXCEPTION 'Unauthorized: Only church Accountants can approve member access requests.';
    END IF;

    IF p_member_id IS NOT NULL THEN
        v_final_member_id := p_member_id;
        IF p_village_name IS NOT NULL AND length(trim(p_village_name)) > 0 THEN
            UPDATE public.members SET village_name = trim(p_village_name) WHERE id = v_final_member_id;
        END IF;
        IF p_gender IS NOT NULL AND p_gender IN ('male', 'female', 'other', 'prefer_not_to_say') THEN
            UPDATE public.members SET gender = p_gender WHERE id = v_final_member_id;
        END IF;
    ELSE
        v_member_number := public.generate_next_church_member_number(v_req.church_id);

        INSERT INTO public.members (
            church_id,
            member_number,
            full_name,
            contact_phone,
            village_name,
            gender,
            joining_date,
            membership_status,
            created_by,
            updated_by
        ) VALUES (
            v_req.church_id,
            v_member_number,
            COALESCE(trim(p_create_member_name), v_req.applicant_name),
            v_req.applicant_phone,
            trim(p_village_name),
            p_gender,
            CURRENT_DATE,
            'active',
            v_actor_id,
            v_actor_id
        )
        RETURNING id INTO v_final_member_id;
    END IF;

    INSERT INTO public.member_account_links (
        church_id,
        member_id,
        user_id,
        linked_by
    ) VALUES (
        v_req.church_id,
        v_final_member_id,
        v_req.user_id,
        v_actor_id
    );

    INSERT INTO public.church_access (
        church_id,
        user_id,
        role,
        status,
        granted_by,
        notes
    ) VALUES (
        v_req.church_id,
        v_req.user_id,
        'member',
        'approved',
        v_actor_id,
        'Approved by Accountant'
    )
    ON CONFLICT (church_id, user_id, role) DO UPDATE SET status = 'approved';

    UPDATE public.access_requests
    SET
        status = 'approved',
        decided_at = timezone('utc'::text, now()),
        decided_by = v_actor_id,
        linked_member_id = v_final_member_id
    WHERE id = p_request_id;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        new_state,
        reason
    ) VALUES (
        v_req.church_id,
        v_actor_id,
        'access_request.approved',
        'access_request',
        p_request_id::text,
        'Approved member access for ' || v_req.applicant_name,
        jsonb_build_object('member_id', v_final_member_id, 'user_id', v_req.user_id),
        'Accountant verified applicant'
    );

    RETURN jsonb_build_object('success', true, 'member_id', v_final_member_id);
END;
$$;

-- 7. APPROVE ACCESS REQUEST V2 (Field-by-field review, Indian mobile validation)
CREATE OR REPLACE FUNCTION public.approve_access_request_v2(
    p_request_id UUID,
    p_expected_version INT,
    p_member_id UUID DEFAULT NULL,
    p_create_new BOOLEAN DEFAULT false,
    p_final_full_name TEXT DEFAULT NULL,
    p_final_date_of_birth DATE DEFAULT NULL,
    p_final_phone TEXT DEFAULT NULL,
    p_final_village_name TEXT DEFAULT NULL,
    p_final_gender TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_req RECORD;
    v_final_member_id UUID;
    v_has_accountant_role BOOLEAN;
    v_member_number TEXT;
    v_old_member RECORD;
    v_target_church_id UUID;
    v_clean_phone TEXT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_req
    FROM public.access_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_req.id IS NULL THEN
        RAISE EXCEPTION 'Access request not found.';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Request is not in pending status (Current: %).', v_req.status;
    END IF;

    IF v_req.submission_version <> p_expected_version THEN
        RAISE EXCEPTION 'Stale review: The applicant updated their application (version % -> %). Please review the latest submission.',
            p_expected_version, v_req.submission_version;
    END IF;

    v_target_church_id := v_req.church_id;

    SELECT EXISTS (
        SELECT 1 FROM public.church_access
        WHERE church_id = v_target_church_id AND user_id = v_actor_id AND role = 'accountant' AND status = 'approved'
    ) INTO v_has_accountant_role;

    IF NOT v_has_accountant_role AND NOT public.is_platform_admin(v_actor_id) THEN
        RAISE EXCEPTION 'Unauthorized: Only church Accountants can approve member access requests.';
    END IF;

    IF p_final_full_name IS NULL OR length(trim(p_final_full_name)) = 0 THEN
        RAISE EXCEPTION 'Final reviewed full name is required.';
    END IF;
    IF p_final_date_of_birth IS NULL THEN
        RAISE EXCEPTION 'Final reviewed date of birth is required.';
    END IF;

    v_clean_phone := regexp_replace(trim(COALESCE(p_final_phone, '')), '[\s\-()]', '', 'g');
    IF v_clean_phone ~ '^\+91[0-9]{10}$' THEN
        v_clean_phone := substr(v_clean_phone, 4);
    ELSIF v_clean_phone ~ '^91[0-9]{10}$' THEN
        v_clean_phone := substr(v_clean_phone, 3);
    ELSIF v_clean_phone ~ '^0[0-9]{10}$' THEN
        v_clean_phone := substr(v_clean_phone, 2);
    END IF;

    IF v_clean_phone !~ '^[6-9][0-9]{9}$' OR v_clean_phone ~ '^([0-9])\1{9}$' THEN
        RAISE EXCEPTION 'Final reviewed mobile number must be a valid 10-digit Indian mobile number.';
    END IF;

    IF p_final_village_name IS NULL OR length(trim(p_final_village_name)) = 0 THEN
        RAISE EXCEPTION 'Final reviewed Village / City Name is required.';
    END IF;
    IF p_final_gender IS NULL OR p_final_gender NOT IN ('male', 'female', 'other', 'prefer_not_to_say') THEN
        RAISE EXCEPTION 'Final reviewed gender must be one of: male, female, other, prefer_not_to_say.';
    END IF;

    IF p_create_new THEN
        v_member_number := public.generate_next_church_member_number(v_target_church_id);

        INSERT INTO public.members (
            church_id,
            member_number,
            full_name,
            contact_phone,
            village_name,
            gender,
            date_of_birth,
            joining_date,
            membership_status,
            created_by,
            updated_by
        ) VALUES (
            v_target_church_id,
            v_member_number,
            trim(p_final_full_name),
            v_clean_phone,
            trim(p_final_village_name),
            p_final_gender,
            p_final_date_of_birth,
            CURRENT_DATE,
            'active',
            v_actor_id,
            v_actor_id
        )
        RETURNING id INTO v_final_member_id;
    ELSE
        IF p_member_id IS NULL THEN
            RAISE EXCEPTION 'Existing member selection required for mapping.';
        END IF;

        SELECT * INTO v_old_member
        FROM public.members
        WHERE id = p_member_id;

        IF v_old_member.id IS NULL OR v_old_member.church_id <> v_target_church_id THEN
            RAISE EXCEPTION 'Selected member does not belong to this church.';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.member_account_links
            WHERE church_id = v_target_church_id AND member_id = p_member_id AND user_id <> v_req.user_id
        ) THEN
            RAISE EXCEPTION 'This member is already linked to another user account in this church.';
        END IF;

        v_final_member_id := p_member_id;

        UPDATE public.members
        SET
            full_name = trim(p_final_full_name),
            contact_phone = v_clean_phone,
            village_name = trim(p_final_village_name),
            gender = p_final_gender,
            date_of_birth = p_final_date_of_birth,
            updated_at = timezone('utc'::text, now()),
            updated_by = v_actor_id
        WHERE id = v_final_member_id;
    END IF;

    DELETE FROM public.member_account_links
    WHERE church_id = v_target_church_id AND user_id = v_req.user_id;

    INSERT INTO public.member_account_links (
        church_id,
        member_id,
        user_id,
        linked_by
    ) VALUES (
        v_target_church_id,
        v_final_member_id,
        v_req.user_id,
        v_actor_id
    );

    INSERT INTO public.church_access (
        church_id,
        user_id,
        role,
        status,
        granted_by,
        notes
    ) VALUES (
        v_target_church_id,
        v_req.user_id,
        'member',
        'approved',
        v_actor_id,
        'Approved by Accountant via Google OAuth onboarding'
    )
    ON CONFLICT (church_id, user_id, role) DO UPDATE
    SET status = 'approved', granted_at = timezone('utc'::text, now());

    UPDATE public.access_requests
    SET
        status = 'approved',
        decided_at = timezone('utc'::text, now()),
        decided_by = v_actor_id,
        linked_member_id = v_final_member_id,
        reviewed_fields_snapshot = jsonb_build_object(
            'full_name', trim(p_final_full_name),
            'date_of_birth', p_final_date_of_birth,
            'phone', v_clean_phone,
            'village_name', trim(p_final_village_name),
            'gender', p_final_gender,
            'was_created_new', p_create_new
        )
    WHERE id = p_request_id;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        new_state,
        reason
    ) VALUES (
        v_target_church_id,
        v_actor_id,
        'access_request.approved',
        'access_request',
        p_request_id::text,
        'Accountant approved access request and linked to member ' || v_final_member_id::text,
        jsonb_build_object(
            'member_id', v_final_member_id,
            'user_id', v_req.user_id,
            'create_new', p_create_new,
            'village_name', trim(p_final_village_name)
        ),
        'Accountant review and member mapping complete'
    );

    RETURN jsonb_build_object(
        'success', true,
        'member_id', v_final_member_id,
        'church_id', v_target_church_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_access_request(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_access_request(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.approve_access_request_v2(UUID, INT, UUID, BOOLEAN, TEXT, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_access_request_v2(UUID, INT, UUID, BOOLEAN, TEXT, DATE, TEXT, TEXT, TEXT) TO authenticated;

-- 8. RETURN ACCESS REQUEST FOR CORRECTION
CREATE OR REPLACE FUNCTION public.return_access_request_for_correction(
    p_request_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_req RECORD;
    v_has_accountant_role BOOLEAN;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'A clear reason is required to return an application for correction.';
    END IF;

    SELECT * INTO v_req FROM public.access_requests WHERE id = p_request_id;
    IF v_req.id IS NULL THEN
        RAISE EXCEPTION 'Access request not found.';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Only pending requests can be returned for correction.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.church_access
        WHERE church_id = v_req.church_id AND user_id = v_actor_id AND role = 'accountant' AND status = 'approved'
    ) INTO v_has_accountant_role;

    IF NOT v_has_accountant_role AND NOT public.is_platform_admin(v_actor_id) THEN
        RAISE EXCEPTION 'Unauthorized: Only church Accountants can return requests for correction.';
    END IF;

    UPDATE public.access_requests
    SET
        status = 'returned_for_correction',
        decided_at = timezone('utc'::text, now()),
        decided_by = v_actor_id,
        decision_reason = trim(p_reason)
    WHERE id = p_request_id;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        reason
    ) VALUES (
        v_req.church_id,
        v_actor_id,
        'access_request.returned_for_correction',
        'access_request',
        p_request_id::text,
        'Returned application for applicant correction: ' || trim(p_reason),
        trim(p_reason)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 9. MEMBER SELF-SERVICE PROFILE UPDATE (Indian mobile validation + read-only auth email)
CREATE OR REPLACE FUNCTION public.update_my_member_profile(
    p_church_id UUID,
    p_full_name TEXT,
    p_contact_phone TEXT,
    p_gender TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_clean_name TEXT;
    v_clean_phone TEXT;
    v_clean_gender TEXT;
    v_member_id UUID;
    v_old_member RECORD;
    v_new_member RECORD;
    v_new_profile RECORD;
    v_is_suspended BOOLEAN;
    v_has_access BOOLEAN;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_church_id IS NULL THEN
        RAISE EXCEPTION 'Church context is required.';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.church_access
        WHERE church_id = p_church_id
          AND user_id = v_actor_id
          AND status = 'suspended'
    ) INTO v_is_suspended;

    IF v_is_suspended THEN
        RAISE EXCEPTION 'Your access to this church has been suspended.';
    END IF;

    SELECT (
        public.is_platform_admin(v_actor_id)
        OR EXISTS (
            SELECT 1 FROM public.church_access
            WHERE church_id = p_church_id
              AND user_id = v_actor_id
              AND status = 'approved'
        )
    ) INTO v_has_access;

    IF NOT v_has_access THEN
        RAISE EXCEPTION 'Unauthorized: No approved church access for this church.';
    END IF;

    v_clean_name := trim(COALESCE(p_full_name, ''));
    IF length(v_clean_name) = 0 THEN
        RAISE EXCEPTION 'Full name is required.';
    END IF;

    v_clean_phone := regexp_replace(trim(COALESCE(p_contact_phone, '')), '[\s\-()]', '', 'g');
    IF v_clean_phone ~ '^\+91[0-9]{10}$' THEN
        v_clean_phone := substr(v_clean_phone, 4);
    ELSIF v_clean_phone ~ '^91[0-9]{10}$' THEN
        v_clean_phone := substr(v_clean_phone, 3);
    ELSIF v_clean_phone ~ '^0[0-9]{10}$' THEN
        v_clean_phone := substr(v_clean_phone, 2);
    END IF;

    IF length(v_clean_phone) = 0 THEN
        RAISE EXCEPTION 'Mobile number is required.';
    END IF;
    IF v_clean_phone !~ '^[6-9][0-9]{9}$' OR v_clean_phone ~ '^([0-9])\1{9}$' THEN
        RAISE EXCEPTION 'Please enter a valid 10-digit Indian mobile number (starting with 6, 7, 8, or 9).';
    END IF;

    v_clean_gender := lower(trim(COALESCE(p_gender, '')));
    IF v_clean_gender NOT IN ('male', 'female', 'other', 'prefer_not_to_say') THEN
        RAISE EXCEPTION 'Gender selection is required (male, female, other, prefer_not_to_say).';
    END IF;

    UPDATE public.profiles
    SET
        full_name = v_clean_name,
        phone = v_clean_phone,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_actor_id
    RETURNING * INTO v_new_profile;

    SELECT member_id INTO v_member_id
    FROM public.member_account_links
    WHERE church_id = p_church_id AND user_id = v_actor_id
    LIMIT 1;

    IF v_member_id IS NOT NULL THEN
        SELECT * INTO v_old_member
        FROM public.members
        WHERE id = v_member_id AND church_id = p_church_id
        FOR UPDATE;

        IF v_old_member.id IS NOT NULL THEN
            UPDATE public.members
            SET
                full_name = v_clean_name,
                contact_phone = v_clean_phone,
                gender = v_clean_gender,
                updated_at = timezone('utc'::text, now()),
                updated_by = v_actor_id
            WHERE id = v_member_id
            RETURNING * INTO v_new_member;

            INSERT INTO public.audit_logs (
                church_id,
                actor_user_id,
                action,
                entity_type,
                entity_id,
                change_summary,
                previous_state,
                new_state,
                reason
            ) VALUES (
                p_church_id,
                v_actor_id,
                'member.self_profile_updated',
                'member',
                v_member_id::text,
                'Member updated their own profile details (name, mobile, gender)',
                jsonb_build_object(
                    'full_name', v_old_member.full_name,
                    'contact_phone', v_old_member.contact_phone,
                    'gender', v_old_member.gender
                ),
                jsonb_build_object(
                    'full_name', v_new_member.full_name,
                    'contact_phone', v_new_member.contact_phone,
                    'gender', v_new_member.gender
                ),
                'Member profile self-update'
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'profile', CASE WHEN v_new_profile.id IS NOT NULL THEN to_jsonb(v_new_profile) ELSE NULL END,
        'member', CASE WHEN v_new_member.id IS NOT NULL THEN to_jsonb(v_new_member) ELSE NULL END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_member_profile(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_member_profile(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- 10. STAFF ACCESS MANAGEMENT RPCS (Accountants -> Collector from active linked members; Admins -> all staff roles)
CREATE OR REPLACE FUNCTION public.get_church_staff_management_data(
    p_church_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_is_platform_admin BOOLEAN;
    v_actor_role TEXT;
    v_assignments JSONB;
    v_eligible_members JSONB;
    v_profiles JSONB := '[]'::jsonb;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_church_id IS NULL THEN
        RAISE EXCEPTION 'Church context is required.';
    END IF;

    v_is_platform_admin := public.is_platform_admin(v_actor_id);
    v_actor_role := public.get_auth_church_role(p_church_id, v_actor_id);

    IF NOT v_is_platform_admin AND v_actor_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Only Church Admins and Accountants can view staff access management.';
    END IF;

    SELECT COALESCE(jsonb_agg(row_data ORDER BY role_rank, staff_name), '[]'::jsonb)
    INTO v_assignments
    FROM (
        SELECT
            jsonb_build_object(
                'id', ca.id,
                'church_id', ca.church_id,
                'user_id', ca.user_id,
                'role', ca.role,
                'status', ca.status,
                'granted_at', ca.granted_at,
                'granted_by', ca.granted_by,
                'notes', ca.notes,
                'profile', CASE
                    WHEN p.id IS NOT NULL THEN jsonb_build_object(
                        'id', p.id,
                        'email', p.email,
                        'full_name', p.full_name,
                        'phone', p.phone
                    )
                    ELSE NULL
                END,
                'member', CASE
                    WHEN m.id IS NOT NULL THEN jsonb_build_object(
                        'id', m.id,
                        'member_number', m.member_number,
                        'full_name', m.full_name,
                        'village_name', m.village_name,
                        'contact_phone', m.contact_phone,
                        'membership_status', m.membership_status
                    )
                    ELSE NULL
                END
            ) AS row_data,
            CASE ca.role
                WHEN 'admin' THEN 1
                WHEN 'accountant' THEN 2
                WHEN 'collector' THEN 3
                ELSE 4
            END AS role_rank,
            COALESCE(p.full_name, m.full_name, '') AS staff_name
        FROM public.church_access ca
        LEFT JOIN public.profiles p ON p.id = ca.user_id
        LEFT JOIN public.member_account_links mal
            ON mal.church_id = ca.church_id AND mal.user_id = ca.user_id
        LEFT JOIN public.members m
            ON m.id = mal.member_id AND m.church_id = ca.church_id
        WHERE ca.church_id = p_church_id
          AND ca.role IN ('admin', 'accountant', 'collector')
    ) sub;

    SELECT COALESCE(jsonb_agg(member_row ORDER BY member_name), '[]'::jsonb)
    INTO v_eligible_members
    FROM (
        SELECT
            jsonb_build_object(
                'member_id', m.id,
                'member_number', m.member_number,
                'full_name', m.full_name,
                'village_name', m.village_name,
                'contact_phone', m.contact_phone,
                'membership_status', m.membership_status,
                'user_id', mal.user_id,
                'auth_email', COALESCE(p.email, ''),
                'collector_status', ca_col.status
            ) AS member_row,
            m.full_name AS member_name
        FROM public.member_account_links mal
        JOIN public.members m
            ON m.id = mal.member_id AND m.church_id = p_church_id
        JOIN public.profiles p
            ON p.id = mal.user_id
        LEFT JOIN public.church_access ca_col
            ON ca_col.church_id = p_church_id
           AND ca_col.user_id = mal.user_id
           AND ca_col.role = 'collector'
        WHERE mal.church_id = p_church_id
          AND m.membership_status = 'active'
    ) mem_sub;

    IF v_is_platform_admin OR v_actor_role = 'admin' THEN
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', p.id,
                'email', p.email,
                'full_name', p.full_name,
                'phone', p.phone,
                'created_at', p.created_at,
                'updated_at', p.updated_at
            ) ORDER BY p.full_name
        ), '[]'::jsonb)
        INTO v_profiles
        FROM public.profiles p;
    END IF;

    RETURN jsonb_build_object(
        'assignments', v_assignments,
        'eligible_members', v_eligible_members,
        'profiles', v_profiles
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_church_staff_management_data(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_church_staff_management_data(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_church_staff_role(
    p_church_id UUID,
    p_user_id UUID,
    p_role TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_is_platform_admin BOOLEAN;
    v_actor_role TEXT;
    v_target_role TEXT := lower(trim(COALESCE(p_role, '')));
    v_is_active_church_member BOOLEAN;
    v_target_profile RECORD;
    v_member_record RECORD;
    v_assignment RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_church_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'Church and user selection are required.';
    END IF;

    IF v_target_role NOT IN ('collector', 'accountant', 'admin') THEN
        RAISE EXCEPTION 'Invalid staff role. Must be collector, accountant, or admin.';
    END IF;

    v_is_platform_admin := public.is_platform_admin(v_actor_id);
    v_actor_role := public.get_auth_church_role(p_church_id, v_actor_id);

    IF v_is_platform_admin OR v_actor_role = 'admin' THEN
        NULL;
    ELSIF v_actor_role = 'accountant' THEN
        IF v_target_role <> 'collector' THEN
            RAISE EXCEPTION 'Unauthorized: Church Accountants can only assign the Collector role.';
        END IF;

        SELECT EXISTS (
            SELECT 1
            FROM public.member_account_links mal
            JOIN public.members m
              ON m.id = mal.member_id AND m.church_id = p_church_id
            WHERE mal.church_id = p_church_id
              AND mal.user_id = p_user_id
              AND m.membership_status = 'active'
        ) INTO v_is_active_church_member;

        IF NOT v_is_active_church_member THEN
            RAISE EXCEPTION 'Collectors assigned by an Accountant must be active linked members of this church.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unauthorized: Only Church Admins and Accountants can assign staff roles.';
    END IF;

    SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_user_id;
    IF v_target_profile.id IS NULL THEN
        RAISE EXCEPTION 'Selected user account does not exist.';
    END IF;

    SELECT m.* INTO v_member_record
    FROM public.member_account_links mal
    JOIN public.members m ON m.id = mal.member_id AND m.church_id = p_church_id
    WHERE mal.church_id = p_church_id AND mal.user_id = p_user_id
    LIMIT 1;

    INSERT INTO public.church_access (
        church_id,
        user_id,
        role,
        status,
        granted_at,
        granted_by,
        notes
    ) VALUES (
        p_church_id,
        p_user_id,
        v_target_role,
        'approved',
        timezone('utc'::text, now()),
        v_actor_id,
        NULLIF(trim(COALESCE(p_notes, '')), '')
    )
    ON CONFLICT (church_id, user_id, role) DO UPDATE
    SET
        status = 'approved',
        granted_at = timezone('utc'::text, now()),
        granted_by = v_actor_id,
        notes = COALESCE(NULLIF(trim(COALESCE(EXCLUDED.notes, '')), ''), public.church_access.notes)
    RETURNING * INTO v_assignment;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        new_state,
        reason
    ) VALUES (
        p_church_id,
        v_actor_id,
        'staff.role_assigned',
        'church_access',
        v_assignment.id::text,
        'Assigned ' || v_target_role || ' role to ' || COALESCE(v_member_record.full_name, v_target_profile.full_name, v_target_profile.email),
        jsonb_build_object(
            'user_id', p_user_id,
            'role', v_target_role,
            'status', 'approved',
            'member_id', v_member_record.id,
            'member_number', v_member_record.member_number,
            'notes', v_assignment.notes
        ),
        COALESCE(v_assignment.notes, 'Staff role assigned')
    );

    RETURN jsonb_build_object(
        'success', true,
        'assignment_id', v_assignment.id,
        'role', v_assignment.role,
        'status', v_assignment.status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.assign_church_staff_role(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_church_staff_role(UUID, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.toggle_church_staff_status(
    p_church_id UUID,
    p_assignment_id UUID,
    p_new_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_is_platform_admin BOOLEAN;
    v_actor_role TEXT;
    v_clean_status TEXT := lower(trim(COALESCE(p_new_status, '')));
    v_target RECORD;
    v_updated RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF v_clean_status NOT IN ('approved', 'suspended') THEN
        RAISE EXCEPTION 'Invalid status. Must be approved or suspended.';
    END IF;

    SELECT * INTO v_target
    FROM public.church_access
    WHERE id = p_assignment_id AND church_id = p_church_id
    FOR UPDATE;

    IF v_target.id IS NULL THEN
        RAISE EXCEPTION 'Staff assignment not found in this church.';
    END IF;

    IF v_target.role NOT IN ('collector', 'accountant', 'admin') THEN
        RAISE EXCEPTION 'Only staff role assignments (collector, accountant, admin) can be managed here.';
    END IF;

    v_is_platform_admin := public.is_platform_admin(v_actor_id);
    v_actor_role := public.get_auth_church_role(p_church_id, v_actor_id);

    IF v_is_platform_admin OR v_actor_role = 'admin' THEN
        NULL;
    ELSIF v_actor_role = 'accountant' THEN
        IF v_target.role <> 'collector' THEN
            RAISE EXCEPTION 'Unauthorized: Church Accountants can only suspend or restore Collector access.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unauthorized: Only Church Admins and Accountants can modify staff access.';
    END IF;

    UPDATE public.church_access
    SET status = v_clean_status
    WHERE id = v_target.id
    RETURNING * INTO v_updated;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state,
        reason
    ) VALUES (
        p_church_id,
        v_actor_id,
        'staff.status_changed',
        'church_access',
        v_target.id::text,
        'Changed ' || v_target.role || ' access status from ' || v_target.status || ' to ' || v_clean_status,
        jsonb_build_object('role', v_target.role, 'status', v_target.status, 'user_id', v_target.user_id),
        jsonb_build_object('role', v_updated.role, 'status', v_updated.status, 'user_id', v_updated.user_id),
        'Staff access status updated'
    );

    RETURN jsonb_build_object(
        'success', true,
        'assignment_id', v_updated.id,
        'status', v_updated.status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_church_staff_status(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_church_staff_status(UUID, UUID, TEXT) TO authenticated;

-- 11. SINGLE-USE MEMBER PORTAL LINK RPCS
-- Create a single-use link (Admin, Accountant, Collector, or Platform Admin)
CREATE OR REPLACE FUNCTION public.create_member_share_link(
    p_church_id UUID,
    p_member_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_member RECORD;
    v_raw_token TEXT;
    v_token_hash TEXT;
    v_link RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_church_id IS NULL OR p_member_id IS NULL THEN
        RAISE EXCEPTION 'Church and member are required.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant', 'collector') THEN
        RAISE EXCEPTION 'Unauthorized: Only church staff can generate member portal links.';
    END IF;

    SELECT * INTO v_member
    FROM public.members
    WHERE id = p_member_id AND church_id = p_church_id;

    IF v_member.id IS NULL THEN
        RAISE EXCEPTION 'Member not found in this church.';
    END IF;

    -- Supersede any previously active unconsumed link for this member
    UPDATE public.member_share_links
    SET
        status = 'revoked',
        revoked_at = timezone('utc'::text, now()),
        revoked_by = v_actor_id
    WHERE church_id = p_church_id
      AND member_id = p_member_id
      AND status = 'active';

    -- Generate 256-bit cryptographically random token and store only its SHA-256 hash
    v_raw_token := encode(gen_random_bytes(32), 'hex');
    v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

    INSERT INTO public.member_share_links (
        church_id,
        member_id,
        token_hash,
        status,
        created_by
    ) VALUES (
        p_church_id,
        p_member_id,
        v_token_hash,
        'active',
        v_actor_id
    )
    RETURNING * INTO v_link;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        new_state,
        reason
    ) VALUES (
        p_church_id,
        v_actor_id,
        'member.share_link_created',
        'member_share_link',
        v_link.id::text,
        'Generated single-use view-only portal link for member ' || v_member.full_name || ' (' || v_member.member_number || ')',
        jsonb_build_object('member_id', p_member_id, 'link_id', v_link.id, 'status', 'active'),
        'Staff generated single-use member link'
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', v_link.id,
        'raw_token', v_raw_token,
        'status', v_link.status,
        'created_at', v_link.created_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_member_share_link(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_member_share_link(UUID, UUID) TO authenticated;

-- Revoke an active single-use member portal link (Admin, Accountant, Collector, or Platform Admin)
CREATE OR REPLACE FUNCTION public.revoke_member_share_link(
    p_church_id UUID,
    p_link_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_link RECORD;
    v_updated RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant', 'collector') THEN
        RAISE EXCEPTION 'Unauthorized: Only church staff can revoke member portal links.';
    END IF;

    SELECT * INTO v_link
    FROM public.member_share_links
    WHERE id = p_link_id AND church_id = p_church_id
    FOR UPDATE;

    IF v_link.id IS NULL THEN
        RAISE EXCEPTION 'Member share link not found in this church.';
    END IF;

    IF v_link.status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', true,
            'link_id', v_link.id,
            'status', v_link.status
        );
    END IF;

    UPDATE public.member_share_links
    SET
        status = 'revoked',
        revoked_at = timezone('utc'::text, now()),
        revoked_by = v_actor_id
    WHERE id = v_link.id
    RETURNING * INTO v_updated;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state,
        reason
    ) VALUES (
        p_church_id,
        v_actor_id,
        'member.share_link_revoked',
        'member_share_link',
        v_updated.id::text,
        'Revoked active single-use member portal link',
        jsonb_build_object('status', v_link.status, 'member_id', v_link.member_id),
        jsonb_build_object('status', v_updated.status, 'revoked_at', v_updated.revoked_at),
        'Staff revoked member share link'
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', v_updated.id,
        'status', v_updated.status,
        'revoked_at', v_updated.revoked_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_member_share_link(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_member_share_link(UUID, UUID) TO authenticated;

-- Redeem a single-use member portal link without authentication (expires immediately on first open)
CREATE OR REPLACE FUNCTION public.redeem_member_share_link(
    p_raw_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_clean_token TEXT := trim(COALESCE(p_raw_token, ''));
    v_token_hash TEXT;
    v_link RECORD;
    v_consumed_at TIMESTAMPTZ;
    v_church RECORD;
    v_church_public JSONB;
    v_member RECORD;
    v_donations JSONB;
    v_leaderboard_fys JSONB;
BEGIN
    IF length(v_clean_token) < 16 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'invalid',
            'message', 'This member link is invalid or incomplete.'
        );
    END IF;

    v_token_hash := encode(digest(v_clean_token, 'sha256'), 'hex');

    SELECT * INTO v_link
    FROM public.member_share_links
    WHERE token_hash = v_token_hash
    FOR UPDATE;

    IF v_link.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'invalid',
            'message', 'This member link is invalid or does not exist.'
        );
    END IF;

    SELECT id, code, slug, name, address, phone
    INTO v_church
    FROM public.churches
    WHERE id = v_link.church_id;

    IF v_church.id IS NOT NULL THEN
        v_church_public := jsonb_build_object(
            'id', v_church.id,
            'code', v_church.code,
            'slug', v_church.slug,
            'name', v_church.name
        );
    ELSE
        v_church_public := NULL;
    END IF;

    IF v_link.status = 'revoked' THEN
        RETURN jsonb_strip_nulls(jsonb_build_object(
            'success', false,
            'error_code', 'revoked',
            'message', 'This member link was revoked or replaced by church staff. Please request a fresh link or sign in to your church account.',
            'church', v_church_public
        ));
    END IF;

    IF v_link.status = 'consumed' THEN
        RETURN jsonb_strip_nulls(jsonb_build_object(
            'success', false,
            'error_code', 'already_used',
            'message', 'This single-use link has already been opened and expired. Please ask your church staff for a new link or sign in to your church account.',
            'church', v_church_public
        ));
    END IF;

    v_consumed_at := timezone('utc'::text, now());

    UPDATE public.member_share_links
    SET
        status = 'consumed',
        consumed_at = v_consumed_at
    WHERE id = v_link.id;

    SELECT
        id,
        church_id,
        member_number,
        full_name,
        contact_phone,
        village_name,
        gender,
        date_of_birth,
        joining_date,
        membership_status
    INTO v_member
    FROM public.members
    WHERE id = v_link.member_id AND church_id = v_link.church_id;

    IF v_member.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'invalid',
            'message', 'Associated member record could not be found.'
        );
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', d.id,
            'receipt_number', d.receipt_number,
            'donation_date', d.donation_date,
            'amount', d.amount,
            'payment_method', d.payment_method,
            'payment_reference', d.payment_reference,
            'notes', d.notes,
            'category_name', COALESCE(dc.name, 'General'),
            'receiving_account_name', COALESCE(ra.account_name, '')
        )
        ORDER BY d.donation_date DESC, d.created_at DESC
    ), '[]'::jsonb)
    INTO v_donations
    FROM public.donations d
    LEFT JOIN public.donation_categories dc ON dc.id = d.category_id
    LEFT JOIN public.receiving_accounts ra ON ra.id = d.receiving_account_id
    WHERE d.church_id = v_link.church_id
      AND d.member_id = v_link.member_id
      AND d.deleted_at IS NULL;

    -- Build competition rankings grouped by Indian Financial Year (Apr 1 - Mar 31)
    WITH fy_donations AS (
        SELECT
            d.member_id,
            m.full_name,
            m.member_number,
            (m.membership_status = 'active') AS is_active,
            CASE
                WHEN EXTRACT(MONTH FROM d.donation_date) >= 4 THEN EXTRACT(YEAR FROM d.donation_date)::INT
                ELSE EXTRACT(YEAR FROM d.donation_date)::INT - 1
            END AS fy_start_year,
            d.amount
        FROM public.donations d
        JOIN public.members m ON m.id = d.member_id AND m.church_id = d.church_id
        WHERE d.church_id = v_link.church_id
          AND d.deleted_at IS NULL
          AND m.membership_status = 'active'
    ),
    fy_totals AS (
        SELECT
            fy_start_year,
            (fy_start_year::text || '-' || right((fy_start_year + 1)::text, 2)) AS fy_code,
            member_id,
            full_name,
            member_number,
            is_active,
            SUM(amount)::NUMERIC(14, 2) AS total_amount
        FROM fy_donations
        GROUP BY fy_start_year, member_id, full_name, member_number, is_active
    ),
    ranked AS (
        SELECT
            fy_start_year,
            fy_code,
            member_id,
            full_name,
            member_number,
            is_active,
            total_amount,
            (member_id = v_link.member_id) AS is_self,
            RANK() OVER (PARTITION BY fy_code ORDER BY total_amount DESC)::INT AS donor_rank,
            ROW_NUMBER() OVER (PARTITION BY fy_code ORDER BY total_amount DESC, full_name ASC, member_id ASC)::INT AS sort_idx
        FROM fy_totals
    ),
    formatted AS (
        SELECT
            fy_start_year,
            fy_code,
            donor_rank,
            sort_idx,
            total_amount,
            is_active,
            is_self,
            full_name AS display_name,
            member_number AS display_member_number
        FROM ranked
    ),
    fy_summaries AS (
        SELECT
            fy_start_year,
            fy_code,
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'rank', f2.donor_rank,
                            'display_name', f2.display_name,
                            'display_member_number', f2.display_member_number,
                            'total_amount', f2.total_amount,
                            'is_active', f2.is_active,
                            'is_self', f2.is_self
                        )
                        ORDER BY f2.sort_idx
                    )
                    FROM formatted f2
                    WHERE f2.fy_code = f.fy_code AND f2.sort_idx <= 10
                ),
                '[]'::jsonb
            ) AS top_10,
            (
                SELECT jsonb_build_object(
                    'rank', f3.donor_rank,
                    'display_name', f3.display_name,
                    'display_member_number', f3.display_member_number,
                    'total_amount', f3.total_amount,
                    'is_active', f3.is_active,
                    'is_self', true
                )
                FROM formatted f3
                WHERE f3.fy_code = f.fy_code AND f3.is_self = true
                LIMIT 1
            ) AS my_standing
        FROM (SELECT DISTINCT fy_start_year, fy_code FROM formatted) f
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'fy_code', fy_code,
            'top_10', top_10,
            'my_standing', my_standing
        )
        ORDER BY fy_start_year DESC
    ), '[]'::jsonb)
    INTO v_leaderboard_fys
    FROM fy_summaries;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        new_state,
        reason
    ) VALUES (
        v_link.church_id,
        NULL,
        'member.share_link_opened',
        'member_share_link',
        v_link.id::text,
        'Member opened single-use view-only portal link (' || v_member.member_number || ')',
        jsonb_build_object('member_id', v_member.id, 'consumed_at', v_consumed_at),
        'Single-use member link redeemed'
    );

    RETURN jsonb_build_object(
        'success', true,
        'consumed_at', v_consumed_at,
        'church', jsonb_build_object(
            'id', v_church.id,
            'code', v_church.code,
            'slug', v_church.slug,
            'name', v_church.name,
            'address', v_church.address,
            'phone', v_church.phone
        ),
        'member', jsonb_build_object(
            'id', v_member.id,
            'member_number', v_member.member_number,
            'full_name', v_member.full_name,
            'contact_phone', v_member.contact_phone,
            'village_name', v_member.village_name,
            'gender', v_member.gender,
            'date_of_birth', v_member.date_of_birth,
            'joining_date', v_member.joining_date,
            'membership_status', v_member.membership_status
        ),
        'donations', v_donations,
        'leaderboard_fys', v_leaderboard_fys
    );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_member_share_link(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_member_share_link(TEXT) TO anon, authenticated;

-- 11. ANDROID SMS GATEWAY (PLAN B) SAFE STATUS & CREDENTIAL MANAGEMENT RPCS
CREATE OR REPLACE FUNCTION public.get_church_sms_gateway_status(
    p_church_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_row RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT public.is_platform_admin(v_actor_id) THEN
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
        IF v_role IS NULL OR v_role NOT IN ('admin', 'accountant', 'collector') THEN
            RAISE EXCEPTION 'Only authorized church staff can view SMS gateway settings.';
        END IF;
    END IF;

    SELECT
        church_id,
        enabled,
        api_url,
        username,
        (length(trim(COALESCE(password, ''))) > 0) AS has_password,
        device_id,
        sim_number,
        updated_at
    INTO v_row
    FROM public.church_sms_gateways
    WHERE church_id = p_church_id;

    IF v_row.church_id IS NULL THEN
        RETURN jsonb_build_object(
            'configured', false,
            'enabled', false,
            'provider', 'android_sms_gateway',
            'api_url', 'https://api.sms-gate.app/3rdparty/v1',
            'username', NULL,
            'has_password', false,
            'device_id', NULL,
            'sim_number', NULL,
            'updated_at', NULL
        );
    END IF;

    RETURN jsonb_build_object(
        'configured', true,
        'enabled', v_row.enabled,
        'provider', 'android_sms_gateway',
        'api_url', v_row.api_url,
        'username', v_row.username,
        'has_password', v_row.has_password,
        'device_id', v_row.device_id,
        'sim_number', v_row.sim_number,
        'updated_at', v_row.updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_church_sms_gateway_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_church_sms_gateway_status(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_church_sms_gateway(
    p_church_id UUID,
    p_enabled BOOLEAN DEFAULT true,
    p_api_url TEXT DEFAULT 'https://api.sms-gate.app/3rdparty/v1',
    p_username TEXT DEFAULT '',
    p_password TEXT DEFAULT '',
    p_device_id TEXT DEFAULT NULL,
    p_sim_number INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_clean_url TEXT;
    v_host TEXT;
    v_clean_user TEXT;
    v_clean_pass TEXT;
    v_clean_device TEXT;
    v_existing_pass TEXT;
    v_final_pass TEXT;
    v_sim SMALLINT;
    v_enabled BOOLEAN := COALESCE(p_enabled, true);
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT public.is_platform_admin(v_actor_id) THEN
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
        IF v_role IS NULL OR v_role NOT IN ('admin', 'accountant') THEN
            RAISE EXCEPTION 'Only Church Admins or Accountants can configure SMS Gateway settings.';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.churches WHERE id = p_church_id) THEN
        RAISE EXCEPTION 'Church not found.';
    END IF;

    v_clean_url := regexp_replace(trim(COALESCE(p_api_url, '')), '/+$', '');
    IF v_clean_url = '' THEN
        v_clean_url := 'https://api.sms-gate.app/3rdparty/v1';
    END IF;

    IF v_clean_url !~* '^https://[a-z0-9.-]+(?::[0-9]{1,5})?(?:/[^[:space:]]*)?$' THEN
        RAISE EXCEPTION 'Gateway URL must be a valid HTTPS URL (for example, https://api.sms-gate.app/3rdparty/v1).';
    END IF;

    v_host := lower(split_part(split_part(regexp_replace(v_clean_url, '^https://', '', 'i'), '/', 1), ':', 1));
    IF v_host = ''
        OR v_host IN ('localhost', '0.0.0.0', '[::1]', '::1')
        OR v_host ~ '\.(local|internal|localhost)$'
        OR v_host ~ '^127\.'
        OR v_host ~ '^10\.'
        OR v_host ~ '^192\.168\.'
        OR v_host ~ '^169\.254\.'
        OR v_host ~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.'
    THEN
        RAISE EXCEPTION 'Private, loopback, and link-local hosts are not allowed for the Cloud Gateway URL.';
    END IF;

    v_clean_user := trim(COALESCE(p_username, ''));
    IF v_clean_user = '' THEN
        RAISE EXCEPTION 'Gateway username is required.';
    END IF;

    IF p_sim_number IS NOT NULL AND p_sim_number NOT IN (1, 2) THEN
        RAISE EXCEPTION 'SIM slot must be 1, 2, or left automatic.';
    END IF;
    v_sim := p_sim_number::SMALLINT;
    v_clean_device := NULLIF(trim(COALESCE(p_device_id, '')), '');
    v_clean_pass := trim(COALESCE(p_password, ''));

    SELECT password INTO v_existing_pass
    FROM public.church_sms_gateways
    WHERE church_id = p_church_id;

    IF v_clean_pass = '' THEN
        IF v_existing_pass IS NULL OR trim(v_existing_pass) = '' THEN
            RAISE EXCEPTION 'Gateway password is required for initial setup.';
        END IF;
        v_final_pass := v_existing_pass;
    ELSE
        v_final_pass := v_clean_pass;
    END IF;

    INSERT INTO public.church_sms_gateways (
        church_id,
        enabled,
        api_url,
        username,
        password,
        device_id,
        sim_number,
        updated_at,
        updated_by
    ) VALUES (
        p_church_id,
        v_enabled,
        v_clean_url,
        v_clean_user,
        v_final_pass,
        v_clean_device,
        v_sim,
        v_now,
        v_actor_id
    )
    ON CONFLICT (church_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        api_url = EXCLUDED.api_url,
        username = EXCLUDED.username,
        password = EXCLUDED.password,
        device_id = EXCLUDED.device_id,
        sim_number = EXCLUDED.sim_number,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;

    INSERT INTO public.church_settings (
        church_id,
        setting_key,
        setting_value,
        updated_at,
        updated_by
    ) VALUES (
        p_church_id,
        'sms_provider',
        jsonb_build_object(
            'mode', 'android_sms_gateway',
            'provider_enabled', v_enabled
        ),
        v_now,
        v_actor_id
    )
    ON CONFLICT (church_id, setting_key) DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        new_state,
        reason
    ) VALUES (
        p_church_id,
        v_actor_id,
        'church.sms_gateway_updated',
        'church_sms_gateway',
        p_church_id::text,
        'Updated Android SMS Gateway configuration (' || v_clean_url || ', enabled=' || v_enabled || ')',
        jsonb_build_object(
            'provider', 'android_sms_gateway',
            'enabled', v_enabled,
            'api_url', v_clean_url,
            'username', v_clean_user,
            'device_id', v_clean_device,
            'sim_number', v_sim
        ),
        'Church SMS Gateway settings updated'
    );

    RETURN jsonb_build_object(
        'configured', true,
        'enabled', v_enabled,
        'provider', 'android_sms_gateway',
        'api_url', v_clean_url,
        'username', v_clean_user,
        'has_password', true,
        'device_id', v_clean_device,
        'sim_number', v_sim,
        'updated_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_church_sms_gateway(UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_church_sms_gateway(UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT, INT) TO authenticated;

-- 22. RECORD EXPENSE RPC (Admin or Accountant only)
CREATE OR REPLACE FUNCTION public.record_expense(
    p_church_id UUID,
    p_expense_date DATE,
    p_category_id UUID,
    p_paid_from_account_id UUID,
    p_amount NUMERIC(14, 2),
    p_payment_method TEXT,
    p_payee_name TEXT,
    p_bill_reference TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_existing_expense RECORD;
    v_church_exists BOOLEAN;
    v_cat_church_id UUID;
    v_cat_active BOOLEAN;
    v_cat_name TEXT;
    v_acc_church_id UUID;
    v_acc_active BOOLEAN;
    v_clean_payee TEXT;
    v_clean_bill_ref TEXT;
    v_clean_notes TEXT;
    v_clean_idempotency TEXT;
    v_expense_id UUID;
    v_new_expense RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Only Admins and Accountants can record church expenses.';
    END IF;

    v_clean_idempotency := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
    IF v_clean_idempotency IS NOT NULL THEN
        SELECT * INTO v_existing_expense
        FROM public.expenses
        WHERE church_id = p_church_id AND idempotency_key = v_clean_idempotency;

        IF v_existing_expense.id IS NOT NULL THEN
            RETURN to_jsonb(v_existing_expense);
        END IF;
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.churches WHERE id = p_church_id) INTO v_church_exists;
    IF NOT v_church_exists THEN
        RAISE EXCEPTION 'Church not found.';
    END IF;

    IF p_expense_date IS NULL THEN
        RAISE EXCEPTION 'Expense date is required.';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be greater than zero.';
    END IF;

    IF p_payment_method IS NULL OR p_payment_method NOT IN ('Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other') THEN
        RAISE EXCEPTION 'Invalid payment method.';
    END IF;

    v_clean_payee := NULLIF(trim(COALESCE(p_payee_name, '')), '');
    IF v_clean_payee IS NULL THEN
        RAISE EXCEPTION 'Payee / vendor name is required.';
    END IF;

    SELECT church_id, is_active, name INTO v_cat_church_id, v_cat_active, v_cat_name
    FROM public.expense_categories
    WHERE id = p_category_id;

    IF v_cat_church_id IS NULL OR v_cat_church_id <> p_church_id THEN
        RAISE EXCEPTION 'Invalid expense category: Category does not belong to this church.';
    END IF;
    IF NOT v_cat_active THEN
        RAISE EXCEPTION 'Selected expense category is inactive.';
    END IF;

    SELECT church_id, is_active INTO v_acc_church_id, v_acc_active
    FROM public.receiving_accounts
    WHERE id = p_paid_from_account_id;

    IF v_acc_church_id IS NULL OR v_acc_church_id <> p_church_id THEN
        RAISE EXCEPTION 'Invalid account: Paid-from account does not belong to this church.';
    END IF;
    IF NOT v_acc_active THEN
        RAISE EXCEPTION 'Selected paid-from account is inactive.';
    END IF;

    v_clean_bill_ref := NULLIF(trim(COALESCE(p_bill_reference, '')), '');
    v_clean_notes := NULLIF(trim(COALESCE(p_notes, '')), '');

    INSERT INTO public.expenses (
        church_id,
        expense_date,
        category_id,
        paid_from_account_id,
        amount,
        payment_method,
        payee_name,
        bill_reference,
        notes,
        idempotency_key,
        created_by,
        updated_by
    ) VALUES (
        p_church_id,
        p_expense_date,
        p_category_id,
        p_paid_from_account_id,
        p_amount,
        p_payment_method,
        v_clean_payee,
        v_clean_bill_ref,
        v_clean_notes,
        v_clean_idempotency,
        v_actor_id,
        v_actor_id
    )
    RETURNING id INTO v_expense_id;

    SELECT * INTO v_new_expense FROM public.expenses WHERE id = v_expense_id;

    INSERT INTO public.expense_revisions (
        expense_id,
        church_id,
        revision_number,
        change_type,
        previous_snapshot,
        new_snapshot,
        actor_user_id,
        reason
    ) VALUES (
        v_expense_id,
        p_church_id,
        1,
        'created',
        NULL,
        to_jsonb(v_new_expense),
        v_actor_id,
        'Initial expense entry'
    );

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state,
        reason
    ) VALUES (
        p_church_id,
        v_actor_id,
        'expense.created',
        'expense',
        v_expense_id::text,
        'Recorded expense of INR ' || p_amount || ' paid to ' || v_clean_payee || ' (' || v_cat_name || ')',
        NULL,
        to_jsonb(v_new_expense),
        'Expense recorded'
    );

    RETURN to_jsonb(v_new_expense);
END;
$$;

-- 23. CORRECT EXPENSE RPC (Admin or Accountant only; requires audit reason)
CREATE OR REPLACE FUNCTION public.correct_expense(
    p_expense_id UUID,
    p_new_expense_date DATE,
    p_new_category_id UUID,
    p_new_paid_from_account_id UUID,
    p_new_amount NUMERIC(14, 2),
    p_new_payment_method TEXT,
    p_new_payee_name TEXT,
    p_new_bill_reference TEXT,
    p_new_notes TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_old_expense RECORD;
    v_new_expense RECORD;
    v_church_id UUID;
    v_role TEXT;
    v_cat_church_id UUID;
    v_cat_active BOOLEAN;
    v_acc_church_id UUID;
    v_acc_active BOOLEAN;
    v_clean_payee TEXT;
    v_clean_bill_ref TEXT;
    v_clean_notes TEXT;
    v_next_revision INT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'A clear reason is required to correct a saved expense.';
    END IF;

    IF p_new_expense_date IS NULL THEN
        RAISE EXCEPTION 'Expense date is required.';
    END IF;

    IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
        RAISE EXCEPTION 'Expense amount must be greater than zero.';
    END IF;

    IF p_new_payment_method IS NULL OR p_new_payment_method NOT IN ('Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Other') THEN
        RAISE EXCEPTION 'Invalid payment method.';
    END IF;

    v_clean_payee := NULLIF(trim(COALESCE(p_new_payee_name, '')), '');
    IF v_clean_payee IS NULL THEN
        RAISE EXCEPTION 'Payee / vendor name is required.';
    END IF;

    SELECT * INTO v_old_expense FROM public.expenses WHERE id = p_expense_id;
    IF v_old_expense.id IS NULL THEN
        RAISE EXCEPTION 'Expense not found.';
    END IF;
    IF v_old_expense.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot edit a cancelled expense.';
    END IF;

    v_church_id := v_old_expense.church_id;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(v_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Only Admins and Accountants can correct church expenses.';
    END IF;

    SELECT church_id, is_active INTO v_cat_church_id, v_cat_active
    FROM public.expense_categories
    WHERE id = p_new_category_id;

    IF v_cat_church_id IS NULL OR v_cat_church_id <> v_church_id THEN
        RAISE EXCEPTION 'Invalid expense category: Category does not belong to this church.';
    END IF;
    IF p_new_category_id <> v_old_expense.category_id AND NOT v_cat_active THEN
        RAISE EXCEPTION 'Selected expense category is inactive.';
    END IF;

    SELECT church_id, is_active INTO v_acc_church_id, v_acc_active
    FROM public.receiving_accounts
    WHERE id = p_new_paid_from_account_id;

    IF v_acc_church_id IS NULL OR v_acc_church_id <> v_church_id THEN
        RAISE EXCEPTION 'Invalid account: Paid-from account does not belong to this church.';
    END IF;
    IF p_new_paid_from_account_id <> v_old_expense.paid_from_account_id AND NOT v_acc_active THEN
        RAISE EXCEPTION 'Selected paid-from account is inactive.';
    END IF;

    v_clean_bill_ref := NULLIF(trim(COALESCE(p_new_bill_reference, '')), '');
    v_clean_notes := NULLIF(trim(COALESCE(p_new_notes, '')), '');

    UPDATE public.expenses
    SET
        expense_date = p_new_expense_date,
        category_id = p_new_category_id,
        paid_from_account_id = p_new_paid_from_account_id,
        amount = p_new_amount,
        payment_method = p_new_payment_method,
        payee_name = v_clean_payee,
        bill_reference = v_clean_bill_ref,
        notes = v_clean_notes,
        updated_at = timezone('utc'::text, now()),
        updated_by = v_actor_id
    WHERE id = p_expense_id
    RETURNING * INTO v_new_expense;

    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_revision
    FROM public.expense_revisions WHERE expense_id = p_expense_id;

    INSERT INTO public.expense_revisions (
        expense_id,
        church_id,
        revision_number,
        change_type,
        previous_snapshot,
        new_snapshot,
        actor_user_id,
        reason
    ) VALUES (
        p_expense_id,
        v_church_id,
        v_next_revision,
        'corrected',
        to_jsonb(v_old_expense),
        to_jsonb(v_new_expense),
        v_actor_id,
        trim(p_reason)
    );

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state,
        reason
    ) VALUES (
        v_church_id,
        v_actor_id,
        'expense.corrected',
        'expense',
        p_expense_id::text,
        'Corrected expense paid to ' || v_clean_payee || ' (INR ' || p_new_amount || ')',
        to_jsonb(v_old_expense),
        to_jsonb(v_new_expense),
        trim(p_reason)
    );

    RETURN to_jsonb(v_new_expense);
END;
$$;

-- 24. CANCEL / SOFT-DELETE EXPENSE RPC (Admin or Accountant only; requires audit reason)
CREATE OR REPLACE FUNCTION public.cancel_expense(
    p_expense_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_old_expense RECORD;
    v_new_expense RECORD;
    v_church_id UUID;
    v_role TEXT;
    v_next_revision INT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'A clear reason is required to cancel an expense.';
    END IF;

    SELECT * INTO v_old_expense FROM public.expenses WHERE id = p_expense_id;
    IF v_old_expense.id IS NULL THEN
        RAISE EXCEPTION 'Expense not found.';
    END IF;
    IF v_old_expense.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Expense is already cancelled.';
    END IF;

    v_church_id := v_old_expense.church_id;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(v_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Only Admins and Accountants can cancel church expenses.';
    END IF;

    UPDATE public.expenses
    SET
        deleted_at = timezone('utc'::text, now()),
        deleted_by = v_actor_id,
        deletion_reason = trim(p_reason)
    WHERE id = p_expense_id
    RETURNING * INTO v_new_expense;

    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_revision
    FROM public.expense_revisions WHERE expense_id = p_expense_id;

    INSERT INTO public.expense_revisions (
        expense_id,
        church_id,
        revision_number,
        change_type,
        previous_snapshot,
        new_snapshot,
        actor_user_id,
        reason
    ) VALUES (
        p_expense_id,
        v_church_id,
        v_next_revision,
        'cancelled',
        to_jsonb(v_old_expense),
        to_jsonb(v_new_expense),
        v_actor_id,
        trim(p_reason)
    );

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state,
        reason
    ) VALUES (
        v_church_id,
        v_actor_id,
        'expense.cancelled',
        'expense',
        p_expense_id::text,
        'Cancelled expense of INR ' || v_old_expense.amount || ' paid to ' || v_old_expense.payee_name,
        to_jsonb(v_old_expense),
        to_jsonb(v_new_expense),
        trim(p_reason)
    );

    RETURN to_jsonb(v_new_expense);
END;
$$;

REVOKE ALL ON FUNCTION public.record_expense(UUID, DATE, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_expense(UUID, DATE, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.correct_expense(UUID, DATE, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_expense(UUID, DATE, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_expense(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_expense(UUID, TEXT) TO authenticated;

-- 25. CREATE RECEIVING ACCOUNT RPC (Admin or Accountant only; logs audit trail)
CREATE OR REPLACE FUNCTION public.create_receiving_account(
    p_church_id UUID,
    p_account_name TEXT,
    p_account_type TEXT,
    p_bank_name TEXT DEFAULT NULL,
    p_account_number_mask TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_clean_name TEXT;
    v_clean_type TEXT;
    v_clean_bank TEXT;
    v_clean_mask TEXT;
    v_new_account RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Only Admins and Accountants can add Cash & Bank Accounts.';
    END IF;

    v_clean_name := trim(COALESCE(p_account_name, ''));
    IF length(v_clean_name) = 0 THEN
        RAISE EXCEPTION 'Account name is required.';
    END IF;

    v_clean_type := lower(trim(COALESCE(p_account_type, '')));
    IF v_clean_type NOT IN ('cash', 'bank') THEN
        RAISE EXCEPTION 'Account type must be cash or bank.';
    END IF;

    IF v_clean_type = 'bank' THEN
        v_clean_bank := NULLIF(trim(COALESCE(p_bank_name, '')), '');
        v_clean_mask := NULLIF(trim(COALESCE(p_account_number_mask, '')), '');
    ELSE
        v_clean_bank := NULL;
        v_clean_mask := NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.receiving_accounts
        WHERE church_id = p_church_id
          AND lower(trim(account_name)) = lower(v_clean_name)
    ) THEN
        RAISE EXCEPTION 'An account named "%" already exists for this church.', v_clean_name;
    END IF;

    INSERT INTO public.receiving_accounts (
        church_id,
        account_name,
        account_type,
        bank_name,
        account_number_mask,
        is_active
    ) VALUES (
        p_church_id,
        v_clean_name,
        v_clean_type,
        v_clean_bank,
        v_clean_mask,
        true
    )
    RETURNING * INTO v_new_account;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state
    ) VALUES (
        p_church_id,
        v_actor_id,
        'receiving_account.created',
        'receiving_account',
        v_new_account.id::text,
        'Added ' || v_clean_type || ' account "' || v_clean_name || '"',
        NULL,
        to_jsonb(v_new_account)
    );

    RETURN to_jsonb(v_new_account);
END;
$$;

-- 26. UPDATE RECEIVING ACCOUNT RPC (Admin or Accountant only; logs audit trail)
CREATE OR REPLACE FUNCTION public.update_receiving_account(
    p_account_id UUID,
    p_account_name TEXT,
    p_account_type TEXT,
    p_bank_name TEXT DEFAULT NULL,
    p_account_number_mask TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_old_account RECORD;
    v_new_account RECORD;
    v_role TEXT;
    v_clean_name TEXT;
    v_clean_type TEXT;
    v_clean_bank TEXT;
    v_clean_mask TEXT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_old_account FROM public.receiving_accounts WHERE id = p_account_id;
    IF v_old_account.id IS NULL THEN
        RAISE EXCEPTION 'Receiving account not found.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(v_old_account.church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Only Admins and Accountants can update Cash & Bank Accounts.';
    END IF;

    v_clean_name := trim(COALESCE(p_account_name, ''));
    IF length(v_clean_name) = 0 THEN
        RAISE EXCEPTION 'Account name is required.';
    END IF;

    v_clean_type := lower(trim(COALESCE(p_account_type, '')));
    IF v_clean_type NOT IN ('cash', 'bank') THEN
        RAISE EXCEPTION 'Account type must be cash or bank.';
    END IF;

    IF v_clean_type = 'bank' THEN
        v_clean_bank := NULLIF(trim(COALESCE(p_bank_name, '')), '');
        v_clean_mask := NULLIF(trim(COALESCE(p_account_number_mask, '')), '');
    ELSE
        v_clean_bank := NULL;
        v_clean_mask := NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.receiving_accounts
        WHERE church_id = v_old_account.church_id
          AND id <> p_account_id
          AND lower(trim(account_name)) = lower(v_clean_name)
    ) THEN
        RAISE EXCEPTION 'An account named "%" already exists for this church.', v_clean_name;
    END IF;

    UPDATE public.receiving_accounts
    SET
        account_name = v_clean_name,
        account_type = v_clean_type,
        bank_name = v_clean_bank,
        account_number_mask = v_clean_mask
    WHERE id = p_account_id
    RETURNING * INTO v_new_account;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state
    ) VALUES (
        v_old_account.church_id,
        v_actor_id,
        'receiving_account.updated',
        'receiving_account',
        p_account_id::text,
        'Updated account "' || v_clean_name || '"',
        to_jsonb(v_old_account),
        to_jsonb(v_new_account)
    );

    RETURN to_jsonb(v_new_account);
END;
$$;

-- 27. TOGGLE RECEIVING ACCOUNT STATUS RPC (Admin or Accountant only)
CREATE OR REPLACE FUNCTION public.toggle_receiving_account_status(
    p_account_id UUID,
    p_is_active BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_old_account RECORD;
    v_new_account RECORD;
    v_role TEXT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_old_account FROM public.receiving_accounts WHERE id = p_account_id;
    IF v_old_account.id IS NULL THEN
        RAISE EXCEPTION 'Receiving account not found.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(v_old_account.church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Only Admins and Accountants can change account status.';
    END IF;

    UPDATE public.receiving_accounts
    SET is_active = COALESCE(p_is_active, NOT v_old_account.is_active)
    WHERE id = p_account_id
    RETURNING * INTO v_new_account;

    INSERT INTO public.audit_logs (
        church_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        change_summary,
        previous_state,
        new_state
    ) VALUES (
        v_old_account.church_id,
        v_actor_id,
        'receiving_account.status_changed',
        'receiving_account',
        p_account_id::text,
        CASE WHEN v_new_account.is_active THEN 'Activated' ELSE 'Deactivated' END || ' account "' || v_new_account.account_name || '"',
        to_jsonb(v_old_account),
        to_jsonb(v_new_account)
    );

    RETURN to_jsonb(v_new_account);
END;
$$;

REVOKE ALL ON FUNCTION public.create_receiving_account(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_receiving_account(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.update_receiving_account(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_receiving_account(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.toggle_receiving_account_status(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_receiving_account_status(UUID, BOOLEAN) TO authenticated;

-- 11. GET CHURCH VILLAGE OPTIONS (Authenticated onboarding village lookup without member PII)
CREATE OR REPLACE FUNCTION public.get_church_village_options(p_church_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_church_active BOOLEAN;
    v_villages TEXT[];
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_church_id IS NULL THEN
        RETURN ARRAY[]::TEXT[];
    END IF;

    SELECT is_active INTO v_church_active FROM public.churches WHERE id = p_church_id;
    IF v_church_active IS NULL OR NOT v_church_active THEN
        RETURN ARRAY[]::TEXT[];
    END IF;

    SELECT COALESCE(
        array_agg(village_clean ORDER BY lower(village_clean), village_clean),
        ARRAY[]::TEXT[]
    )
    INTO v_villages
    FROM (
        SELECT DISTINCT ON (lower(clean_name)) clean_name AS village_clean
        FROM (
            SELECT btrim(regexp_replace(m.village_name, '\s+', ' ', 'g')) AS clean_name
            FROM public.members m
            WHERE m.church_id = p_church_id
              AND m.village_name IS NOT NULL
              AND length(btrim(m.village_name)) > 0
        ) raw_villages
        ORDER BY lower(clean_name), clean_name
    ) deduped;

    RETURN COALESCE(v_villages, ARRAY[]::TEXT[]);
END;
$$;

REVOKE ALL ON FUNCTION public.get_church_village_options(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_church_village_options(UUID) TO authenticated;

-- ==============================================================================
-- SECTION 7: BACKFILL PROFILES FOR EXISTING AUTH USERS (IF ANY REMAIN)
-- ==============================================================================

INSERT INTO public.profiles (id, email, full_name, phone)
SELECT
    u.id,
    COALESCE(u.email, ''),
    COALESCE(
        NULLIF(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        NULLIF(trim(u.raw_user_meta_data ->> 'name'), ''),
        NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
        'User'
    ),
    NULLIF(trim(COALESCE(u.raw_user_meta_data ->> 'phone', '')), '')
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

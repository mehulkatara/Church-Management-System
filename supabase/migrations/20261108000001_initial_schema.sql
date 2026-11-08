-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - INITIAL DATABASE SCHEMA
-- Migration: 20261108000001_initial_schema.sql
-- Multi-church isolation, verified member accounts, manual receipt registry,
-- audit history, and role-based security.
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. CHURCHES
CREATE TABLE IF NOT EXISTS public.churches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    email TEXT,
    receipt_prefix TEXT DEFAULT 'REC',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

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
    contact_email TEXT,
    village_name TEXT, -- Nullable Unicode text, not exposed on public pages
    gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
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

-- 7. ACCESS REQUESTS (Self-registration approval queue)
CREATE TABLE IF NOT EXISTS public.access_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    applicant_name TEXT NOT NULL,
    applicant_email TEXT NOT NULL,
    applicant_phone TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    decided_at TIMESTAMPTZ,
    decided_by UUID REFERENCES auth.users(id),
    decision_reason TEXT,
    linked_member_id UUID REFERENCES public.members(id),
    CONSTRAINT uq_access_requests_pending UNIQUE (church_id, user_id, status)
);
CREATE INDEX IF NOT EXISTS idx_access_requests_church_status ON public.access_requests(church_id, status);

-- 8. DONATION CATEGORIES
CREATE TABLE IF NOT EXISTS public.donation_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_church_category_code UNIQUE (church_id, code)
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

-- 11. RECEIPT NUMBER REGISTRY (Permanent reservation within church)
CREATE TABLE IF NOT EXISTS public.receipt_number_registry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE RESTRICT,
    normalized_receipt_number TEXT NOT NULL,
    original_receipt_number TEXT NOT NULL,
    donation_id UUID NOT NULL REFERENCES public.donations(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'corrected_old')),
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    reserved_by UUID REFERENCES auth.users(id),
    CONSTRAINT uq_church_normalized_receipt UNIQUE (church_id, normalized_receipt_number)
);
CREATE INDEX IF NOT EXISTS idx_receipt_registry_lookup ON public.receipt_number_registry(church_id, normalized_receipt_number);

-- 12. DONATION REVISIONS (Append-only history of creations, corrections, and cancellations)
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
    client_ip TEXT,
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

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
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
ALTER TABLE public.receipt_number_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;

-- Helper security functions
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

CREATE OR REPLACE FUNCTION public.get_auth_church_role(p_church_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT role FROM public.church_access
    WHERE church_id = p_church_id AND user_id = p_user_id AND status = 'approved'
    LIMIT 1;
$$;

-- PROFILES RLS
CREATE POLICY "Users can read their own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id OR public.is_platform_admin(auth.uid()));

CREATE POLICY "Users can update their own profile basic info"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- CHURCHES RLS
CREATE POLICY "Public/authenticated can see active churches for selection"
    ON public.churches FOR SELECT
    USING (is_active = true OR public.is_platform_admin(auth.uid()));

CREATE POLICY "Platform admins can manage churches"
    ON public.churches FOR ALL
    USING (public.is_platform_admin(auth.uid()));

-- CHURCH ACCESS RLS
CREATE POLICY "Users can view their own church access assignments"
    ON public.church_access FOR SELECT
    USING (
        user_id = auth.uid()
        OR public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- MEMBERS RLS
CREATE POLICY "Staff can view members in their church"
    ON public.members FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
        OR id IN (SELECT member_id FROM public.member_account_links WHERE user_id = auth.uid() AND church_id = members.church_id)
    );

-- DONATIONS RLS
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

-- AUDIT LOGS RLS: Append-only for everyone; viewable by Admin and Accountant
CREATE POLICY "Audits viewable by Admin and Accountant only"
    ON public.audit_logs FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR (church_id IS NOT NULL AND public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant'))
    );

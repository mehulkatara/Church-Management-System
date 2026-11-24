-- ==============================================================================
-- MIGRATION #12: Church Expenses & Per-Church Expense Categories
-- File: supabase/migrations/20261124000001_church_expenses_and_categories.sql
-- Purpose:
--   1. Add public.expense_categories (scoped independently per church)
--   2. Add public.expenses (linked to church, expense category, and paid-from
--      receiving_accounts row, with soft-delete + idempotency support)
--   3. Restrict reads and writes strictly to Admins, Accountants, and Platform Admins
--   4. Add atomic SECURITY DEFINER RPCs: record_expense, correct_expense, cancel_expense
--      with full audit_logs entries
-- ==============================================================================

-- 1. EXPENSE CATEGORIES (Church-specific outgoing expense classifications)
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

-- 2. EXPENSES (Outgoing church payments; soft-delete only via RPCs)
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

-- 3. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- EXPENSE CATEGORIES RLS (Strictly Admin & Accountant; Collectors and Members blocked)
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

-- EXPENSES RLS (Reads strictly Admin & Accountant; writes strictly via SECURITY DEFINER RPCs)
DROP POLICY IF EXISTS "Church admins and accountants can view expenses" ON public.expenses;
CREATE POLICY "Church admins and accountants can view expenses"
    ON public.expenses FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- 4. RECORD EXPENSE RPC (Admin or Accountant only)
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

-- 5. CORRECT EXPENSE RPC (Admin or Accountant only; requires audit reason)
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

-- 6. CANCEL / SOFT-DELETE EXPENSE RPC (Admin or Accountant only; requires audit reason)
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

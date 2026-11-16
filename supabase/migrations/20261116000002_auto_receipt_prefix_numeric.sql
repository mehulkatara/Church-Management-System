-- ==============================================================================
-- INCREMENTAL MIGRATION: Automatic Church-Code + FY Receipt Prefix & Numeric Entry
-- File: supabase/migrations/20261116000002_auto_receipt_prefix_numeric.sql
-- Safe & idempotent for incremental deployment onto an existing database.
-- Note: Canonical full schema snapshot is maintained in supabase/complete_schema.sql.
-- ==============================================================================

-- 1. Remove manual receipt_prefix column from churches
ALTER TABLE public.churches
    DROP COLUMN IF EXISTS receipt_prefix;

-- 2. Compute Indian Financial Year (1 April through 31 March) code from donation date
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

-- 3. Format & validate canonical receipt number: UPPER(CHURCH_CODE)/YYYY-YY/<positive int without leading zeros>
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

    -- Support either raw digits ("142") or exact canonical full string ("CHURCH_CODE/2026-27/142")
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

-- 4. Live frontend availability / duplicate check RPC (preserves strict zero-client-RLS on receipt_number_registry)
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
    v_conflict BOOLEAN;
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
        RAISE EXCEPTION 'Unauthorized: Only church staff can verify receipt availability.';
    END IF;

    SELECT code INTO v_church_code
    FROM public.churches
    WHERE id = p_church_id;

    IF v_church_code IS NULL THEN
        RAISE EXCEPTION 'Church not found.';
    END IF;

    v_canonical := public.normalize_auto_receipt_number(v_church_code, p_donation_date, p_receipt_number);
    v_normalized := lower(v_canonical);

    SELECT EXISTS (
        SELECT 1
        FROM public.receipt_number_registry r
        WHERE r.church_id = p_church_id
          AND r.normalized_receipt_number = v_normalized
          AND (
              p_exclude_donation_id IS NULL
              OR NOT (r.donation_id = p_exclude_donation_id AND r.status = 'active')
          )
    ) INTO v_conflict;

    RETURN jsonb_build_object(
        'available', NOT v_conflict,
        'formatted_receipt', v_canonical
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_receipt_number_availability(UUID, DATE, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_receipt_number_availability(UUID, DATE, TEXT, UUID) TO authenticated;

-- 5. Update record_donation to enforce CHURCH_CODE/YYYY-YY/<number> server-side
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
    v_normalized_receipt TEXT;
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
    v_normalized_receipt := lower(v_canonical_receipt);

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

    IF EXISTS (
        SELECT 1 FROM public.receipt_number_registry
        WHERE church_id = p_church_id AND normalized_receipt_number = v_normalized_receipt
    ) THEN
        RAISE EXCEPTION 'Receipt number % already exists for this church. Please enter an unused receipt number.', v_canonical_receipt;
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
        p_idempotency_key,
        v_actor_id,
        v_actor_id
    )
    RETURNING id INTO v_donation_id;

    INSERT INTO public.receipt_number_registry (
        church_id,
        normalized_receipt_number,
        original_receipt_number,
        donation_id,
        status,
        reserved_by
    ) VALUES (
        p_church_id,
        v_normalized_receipt,
        v_canonical_receipt,
        v_donation_id,
        'active',
        v_actor_id
    );

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

-- 6. Update correct_donation to enforce CHURCH_CODE/YYYY-YY/<number> server-side
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
    v_next_revision INT;
    v_old_norm_receipt TEXT;
    v_new_canonical_receipt TEXT;
    v_new_norm_receipt TEXT;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'A clear reason is required to correct a saved donation.';
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

    v_new_canonical_receipt := public.normalize_auto_receipt_number(v_church_code, p_new_donation_date, p_new_receipt_number);
    v_old_norm_receipt := lower(trim(v_old_donation.receipt_number));
    v_new_norm_receipt := lower(v_new_canonical_receipt);

    IF v_old_norm_receipt <> v_new_norm_receipt THEN
        IF EXISTS (
            SELECT 1 FROM public.receipt_number_registry
            WHERE church_id = v_church_id AND normalized_receipt_number = v_new_norm_receipt
        ) THEN
            RAISE EXCEPTION 'Receipt number % already exists for this church. Please enter an unused receipt number.', v_new_canonical_receipt;
        END IF;

        UPDATE public.receipt_number_registry
        SET status = 'corrected_old'
        WHERE church_id = v_church_id AND normalized_receipt_number = v_old_norm_receipt;

        INSERT INTO public.receipt_number_registry (
            church_id,
            normalized_receipt_number,
            original_receipt_number,
            donation_id,
            status,
            reserved_by
        ) VALUES (
            v_church_id,
            v_new_norm_receipt,
            v_new_canonical_receipt,
            p_donation_id,
            'active',
            v_actor_id
        );
    END IF;

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
        'Corrected donation (Revision #' || v_next_revision || ')',
        to_jsonb(v_old_donation),
        to_jsonb(v_new_donation),
        trim(p_reason)
    );

    RETURN to_jsonb(v_new_donation);
END;
$$;

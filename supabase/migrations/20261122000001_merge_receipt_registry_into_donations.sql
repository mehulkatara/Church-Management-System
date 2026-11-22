-- ==============================================================================
-- MIGRATION: Merge public.receipt_number_registry into public.donations
-- Purpose:
--   1. Enforce receipt number uniqueness per church directly on active rows in
--      public.donations (deleted_at IS NULL) via partial unique index
--      uq_donations_active_receipt.
--   2. Allow reusing cancelled receipt numbers (deleted_at IS NOT NULL) and old
--      receipt numbers freed by Admin/Accountant corrections, while keeping all
--      cancelled rows, donation_revisions, and audit_logs intact.
--   3. Update receipt availability check and donation mutation RPCs to read and
--      validate against public.donations directly.
--   4. Drop the redundant public.receipt_number_registry table.
-- ==============================================================================

-- 1. Partial unique index on active donations (case-insensitive & trimmed)
CREATE UNIQUE INDEX IF NOT EXISTS uq_donations_active_receipt
    ON public.donations (church_id, lower(trim(receipt_number)))
    WHERE deleted_at IS NULL;

-- 2. Live frontend availability / duplicate check RPC (queries active donations directly)
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
    v_normalized := lower(trim(v_canonical));

    SELECT EXISTS (
        SELECT 1
        FROM public.donations d
        WHERE d.church_id = p_church_id
          AND d.deleted_at IS NULL
          AND lower(trim(d.receipt_number)) = v_normalized
          AND (
              p_exclude_donation_id IS NULL
              OR d.id <> p_exclude_donation_id
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

-- 3. Record donation (checks & enforces uniqueness directly on public.donations)
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
    v_normalized_receipt := lower(trim(v_canonical_receipt));

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
        SELECT 1 FROM public.donations d
        WHERE d.church_id = p_church_id
          AND d.deleted_at IS NULL
          AND lower(trim(d.receipt_number)) = v_normalized_receipt
    ) THEN
        RAISE EXCEPTION 'Receipt number % already exists for this church. Please enter an unused receipt number.', v_canonical_receipt;
    END IF;

    BEGIN
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
    EXCEPTION
        WHEN unique_violation THEN
            IF SQLERRM ILIKE '%uq_donations_active_receipt%' THEN
                RAISE EXCEPTION 'Receipt number % already exists for this church. Please enter an unused receipt number.', v_canonical_receipt;
            END IF;
            RAISE;
    END;

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

REVOKE ALL ON FUNCTION public.record_donation(UUID, UUID, TEXT, DATE, UUID, NUMERIC, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_donation(UUID, UUID, TEXT, DATE, UUID, NUMERIC, UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 4. Correct donation (frees old receipt number immediately when changed, enforces uniqueness on active donations)
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
    v_old_norm_receipt := lower(trim(v_old_donation.receipt_number));
    v_new_norm_receipt := lower(trim(v_new_canonical_receipt));

    IF v_old_norm_receipt <> v_new_norm_receipt THEN
        IF EXISTS (
            SELECT 1 FROM public.donations d
            WHERE d.church_id = v_church_id
              AND d.deleted_at IS NULL
              AND d.id <> p_donation_id
              AND lower(trim(d.receipt_number)) = v_new_norm_receipt
        ) THEN
            RAISE EXCEPTION 'Receipt number % already exists for this church. Please enter an unused receipt number.', v_new_canonical_receipt;
        END IF;
    END IF;

    BEGIN
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
    EXCEPTION
        WHEN unique_violation THEN
            IF SQLERRM ILIKE '%uq_donations_active_receipt%' THEN
                RAISE EXCEPTION 'Receipt number % already exists for this church. Please enter an unused receipt number.', v_new_canonical_receipt;
            END IF;
            RAISE;
    END;

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

REVOKE ALL ON FUNCTION public.correct_donation(UUID, TEXT, NUMERIC, UUID, UUID, DATE, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_donation(UUID, TEXT, NUMERIC, UUID, UUID, DATE, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- 5. Cancel / Soft-delete donation (frees receipt number for reuse while keeping cancelled row & audit trail)
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
        'Cancelled donation receipt ' || v_old_donation.receipt_number,
        to_jsonb(v_old_donation),
        to_jsonb(v_new_donation),
        trim(p_reason)
    );

    RETURN to_jsonb(v_new_donation);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_donation(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_donation(UUID, TEXT) TO authenticated;

-- 6. Drop the redundant receipt_number_registry table and its dependent indexes/constraints
DROP TABLE IF EXISTS public.receipt_number_registry CASCADE;

-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - ATOMIC FUNCTIONS & BUSINESS OPERATIONS
-- Migration: 20261108000002_atomic_functions.sql
-- Enforces concurrency protection, receipt uniqueness, accountant-only status rules,
-- and append-only audit tracking.
-- ==============================================================================

-- 1. RECORD DONATION (Atomic transaction with receipt reservation & audit)
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
    v_cat_name TEXT;
BEGIN
    -- Authorization check: Actor must be Admin, Accountant, or Collector for this church
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

    -- Idempotency check: If idempotency_key is provided and already exists, return previous record
    IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
        SELECT id INTO v_existing_donation_id
        FROM public.donations
        WHERE church_id = p_church_id AND idempotency_key = p_idempotency_key;

        IF v_existing_donation_id IS NOT NULL THEN
            SELECT * INTO v_new_donation FROM public.donations WHERE id = v_existing_donation_id;
            RETURN to_jsonb(v_new_donation);
        END IF;
    END IF;

    -- Validate amount
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Donation amount must be greater than zero.';
    END IF;

    -- Validate Receipt Number
    IF p_receipt_number IS NULL OR length(trim(p_receipt_number)) = 0 THEN
        RAISE EXCEPTION 'Receipt number is required.';
    END IF;
    v_normalized_receipt := lower(trim(p_receipt_number));

    -- Validate Member belongs to church
    SELECT church_id, full_name INTO v_member_church_id, v_member_name
    FROM public.members WHERE id = p_member_id;

    IF v_member_church_id IS NULL OR v_member_church_id <> p_church_id THEN
        RAISE EXCEPTION 'Invalid member: Member does not belong to this church.';
    END IF;

    -- Validate Category belongs to church and is active
    SELECT church_id, is_active, name INTO v_cat_church_id, v_cat_active, v_cat_name
    FROM public.donation_categories WHERE id = p_category_id;

    IF v_cat_church_id IS NULL OR v_cat_church_id <> p_church_id THEN
        RAISE EXCEPTION 'Invalid category: Category does not belong to this church.';
    END IF;
    IF NOT v_cat_active THEN
        RAISE EXCEPTION 'Selected donation category is inactive.';
    END IF;

    -- Validate Receiving Account belongs to church and is active
    SELECT church_id, is_active INTO v_acc_church_id, v_acc_active
    FROM public.receiving_accounts WHERE id = p_receiving_account_id;

    IF v_acc_church_id IS NULL OR v_acc_church_id <> p_church_id THEN
        RAISE EXCEPTION 'Invalid receiving account: Account does not belong to this church.';
    END IF;
    IF NOT v_acc_active THEN
        RAISE EXCEPTION 'Selected receiving account is inactive.';
    END IF;

    -- Check Church exists
    SELECT name INTO v_church_name FROM public.churches WHERE id = p_church_id;

    -- Receipt Number Uniqueness Check within this church
    IF EXISTS (
        SELECT 1 FROM public.receipt_number_registry
        WHERE church_id = p_church_id AND normalized_receipt_number = v_normalized_receipt
    ) THEN
        RAISE EXCEPTION 'This receipt number already exists for this church. Please check the number and try again.';
    END IF;

    -- Insert Donation
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
        trim(p_receipt_number),
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

    -- Atomically reserve receipt in registry
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
        trim(p_receipt_number),
        v_donation_id,
        'active',
        v_actor_id
    );

    -- Fetch inserted donation for snapshots
    SELECT * INTO v_new_donation FROM public.donations WHERE id = v_donation_id;

    -- Write initial revision
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

    -- Write audit log
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
        'Recorded donation of INR ' || p_amount || ' with receipt ' || trim(p_receipt_number),
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
    v_role TEXT;
    v_next_revision INT;
    v_old_norm_receipt TEXT;
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

    -- Strict permission check: ONLY Admin or Accountant for this church can edit
    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(v_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant') THEN
        RAISE EXCEPTION 'Unauthorized: Collectors and Members cannot edit saved donations.';
    END IF;

    -- Handle Receipt Number correction if changed
    v_old_norm_receipt := lower(trim(v_old_donation.receipt_number));
    v_new_norm_receipt := lower(trim(p_new_receipt_number));

    IF v_old_norm_receipt <> v_new_norm_receipt THEN
        -- Verify new receipt isn't already reserved
        IF EXISTS (
            SELECT 1 FROM public.receipt_number_registry
            WHERE church_id = v_church_id AND normalized_receipt_number = v_new_norm_receipt
        ) THEN
            RAISE EXCEPTION 'This receipt number already exists for this church. Please check the number and try again.';
        END IF;

        -- Mark old receipt as corrected_old (remains permanently reserved)
        UPDATE public.receipt_number_registry
        SET status = 'corrected_old'
        WHERE church_id = v_church_id AND normalized_receipt_number = v_old_norm_receipt;

        -- Insert new receipt
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
            trim(p_new_receipt_number),
            p_donation_id,
            'active',
            v_actor_id
        );
    END IF;

    -- Update donation
    UPDATE public.donations
    SET
        receipt_number = trim(p_new_receipt_number),
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

    -- Determine next revision number
    SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_revision
    FROM public.donation_revisions WHERE donation_id = p_donation_id;

    -- Insert revision
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

    -- Audit log
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

-- 3. CANCEL / SOFT-DELETE DONATION (Admin or Accountant only; permanent reservation remains)
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

    -- Soft delete donation
    UPDATE public.donations
    SET
        deleted_at = timezone('utc'::text, now()),
        deleted_by = v_actor_id,
        deletion_reason = trim(p_reason)
    WHERE id = p_donation_id
    RETURNING * INTO v_new_donation;

    -- Mark receipt status as cancelled (receipt remains permanently reserved)
    UPDATE public.receipt_number_registry
    SET status = 'cancelled'
    WHERE donation_id = p_donation_id;

    -- Revision
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

    -- Audit log
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

-- 4. CHANGE MEMBER STATUS (Strictly restricted to church Accountants; Platform Admin alone CANNOT change)
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
    v_has_accountant_role BOOLEAN;
    v_old_member RECORD;
    v_new_member RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- STRICT RULE: Only user with explicit 'accountant' role in THIS church can change status.
    -- Platform Admin does NOT implicitly satisfy this permission.
    SELECT EXISTS (
        SELECT 1 FROM public.church_access
        WHERE church_id = p_church_id
          AND user_id = v_actor_id
          AND role = 'accountant'
          AND status = 'approved'
    ) INTO v_has_accountant_role;

    IF NOT v_has_accountant_role THEN
        RAISE EXCEPTION 'Unauthorized: Only a user with an explicit, current Accountant assignment for this church may change membership status.';
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

    -- Audit status change
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

-- 5. APPROVE ACCESS REQUEST
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

    -- Only Accountant can approve
    SELECT EXISTS (
        SELECT 1 FROM public.church_access
        WHERE church_id = v_req.church_id AND user_id = v_actor_id AND role = 'accountant' AND status = 'approved'
    ) INTO v_has_accountant_role;

    IF NOT v_has_accountant_role AND NOT public.is_platform_admin(v_actor_id) THEN
        RAISE EXCEPTION 'Unauthorized: Only church Accountants can approve member access requests.';
    END IF;

    IF p_member_id IS NOT NULL THEN
        v_final_member_id := p_member_id;
        -- Update village name and gender if provided and missing
        IF p_village_name IS NOT NULL AND length(trim(p_village_name)) > 0 THEN
            UPDATE public.members SET village_name = trim(p_village_name) WHERE id = v_final_member_id;
        END IF;
        IF p_gender IS NOT NULL AND p_gender IN ('male', 'female', 'other', 'prefer_not_to_say') THEN
            UPDATE public.members SET gender = p_gender WHERE id = v_final_member_id;
        END IF;
    ELSE
        -- Create new member
        v_member_number := 'M-' || lpad((COALESCE((SELECT COUNT(*) FROM public.members WHERE church_id = v_req.church_id), 0) + 1)::text, 4, '0');

        INSERT INTO public.members (
            church_id,
            member_number,
            full_name,
            contact_phone,
            contact_email,
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
            v_req.applicant_email,
            trim(p_village_name),
            p_gender,
            CURRENT_DATE,
            'active',
            v_actor_id,
            v_actor_id
        )
        RETURNING id INTO v_final_member_id;
    END IF;

    -- Link account to member (1:1 in this church)
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

    -- Grant Member access
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

    -- Mark request approved
    UPDATE public.access_requests
    SET
        status = 'approved',
        decided_at = timezone('utc'::text, now()),
        decided_by = v_actor_id,
        linked_member_id = v_final_member_id
    WHERE id = p_request_id;

    -- Audit log
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

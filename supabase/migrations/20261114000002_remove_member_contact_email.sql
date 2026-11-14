-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - REMOVE DUPLICATE CONTACT EMAIL FOR MEMBERS
-- Migration: 20261114000002_remove_member_contact_email.sql
-- Removes contact_email usage for members while keeping authentication email
-- in auth.users / profiles / access_requests intact.
-- Non-destructive: clears members.contact_email values and stops writing
-- contact_email inside approve_access_request_v2 and approve_access_request.
-- ==============================================================================

-- 1. Clear existing duplicate contact_email values on members
UPDATE public.members
SET contact_email = NULL
WHERE contact_email IS NOT NULL;

-- 2. Update approve_access_request_v2 so member creation/linking never writes contact_email
CREATE OR REPLACE FUNCTION public.approve_access_request_v2(
    p_request_id UUID,
    p_expected_version INT,
    p_member_id UUID DEFAULT NULL,
    p_create_new BOOLEAN DEFAULT false,
    p_final_full_name TEXT DEFAULT NULL,
    p_final_date_of_birth DATE DEFAULT NULL,
    p_final_phone TEXT DEFAULT NULL,
    p_final_contact_email TEXT DEFAULT NULL,
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

    -- Fetch and lock request
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

    -- Concurrency check: Ensure version has not changed while Accountant was reviewing
    IF v_req.submission_version <> p_expected_version THEN
        RAISE EXCEPTION 'Stale review: The applicant updated their application (version % -> %). Please review the latest submission.',
            p_expected_version, v_req.submission_version;
    END IF;

    v_target_church_id := v_req.church_id;

    -- Verify caller is church Accountant or Platform Admin
    SELECT EXISTS (
        SELECT 1 FROM public.church_access
        WHERE church_id = v_target_church_id AND user_id = v_actor_id AND role = 'accountant' AND status = 'approved'
    ) INTO v_has_accountant_role;

    IF NOT v_has_accountant_role AND NOT public.is_platform_admin(v_actor_id) THEN
        RAISE EXCEPTION 'Unauthorized: Only church Accountants can approve member access requests.';
    END IF;

    -- Validate final reviewed fields completeness
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
        -- Create New Member in this church (no member contact_email; auth email lives in auth.users/profiles)
        v_member_number := 'M-' || lpad((COALESCE((SELECT COUNT(*) FROM public.members WHERE church_id = v_target_church_id), 0) + 1)::text, 4, '0');

        INSERT INTO public.members (
            church_id,
            member_number,
            full_name,
            contact_phone,
            contact_email,
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
            NULL,
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
        -- Mapping to Existing Member
        IF p_member_id IS NULL THEN
            RAISE EXCEPTION 'Existing member selection required for mapping.';
        END IF;

        -- Verify member belongs to same church
        SELECT * INTO v_old_member
        FROM public.members
        WHERE id = p_member_id;

        IF v_old_member.id IS NULL OR v_old_member.church_id <> v_target_church_id THEN
            RAISE EXCEPTION 'Selected member does not belong to this church.';
        END IF;

        -- Check if member is already linked to another account in this church
        IF EXISTS (
            SELECT 1 FROM public.member_account_links
            WHERE church_id = v_target_church_id AND member_id = p_member_id AND user_id <> v_req.user_id
        ) THEN
            RAISE EXCEPTION 'This member is already linked to another user account in this church.';
        END IF;

        v_final_member_id := p_member_id;

        -- Update member with reviewed fields (clear contact_email; auth email lives in auth.users/profiles)
        UPDATE public.members
        SET
            full_name = trim(p_final_full_name),
            contact_phone = v_clean_phone,
            contact_email = NULL,
            village_name = trim(p_final_village_name),
            gender = p_final_gender,
            date_of_birth = p_final_date_of_birth,
            updated_at = timezone('utc'::text, now()),
            updated_by = v_actor_id
        WHERE id = v_final_member_id;
    END IF;

    -- Ensure 1:1 account linkage in this church
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

    -- Grant Member access role
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

    -- Mark request approved
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

    -- Write authoritative audit log
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

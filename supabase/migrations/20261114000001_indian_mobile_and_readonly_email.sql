-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - INDIAN MOBILE VALIDATION & READ-ONLY EMAIL
-- Migration: 20261114000001_indian_mobile_and_readonly_email.sql
-- 1. Prevents members from modifying contact_email (or auth email) via
--    update_my_member_profile.
-- 2. Enforces strict Indian 10-digit mobile number validation (^[6-9][0-9]{9}$)
--    without requiring a +91 prefix across member self-update and onboarding.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.update_my_member_profile(
    p_church_id UUID,
    p_full_name TEXT,
    p_contact_phone TEXT,
    p_gender TEXT,
    p_contact_email TEXT DEFAULT NULL
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

    -- Verify user has active/approved access in this church and is not suspended
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

    -- 1. Mandatory Full Name
    v_clean_name := trim(COALESCE(p_full_name, ''));
    IF length(v_clean_name) = 0 THEN
        RAISE EXCEPTION 'Full name is required.';
    END IF;

    -- 2. Mandatory Indian 10-digit Mobile Number (strip spaces/dashes and optional +91/91/0)
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

    -- 3. Mandatory Gender
    v_clean_gender := lower(trim(COALESCE(p_gender, '')));
    IF v_clean_gender NOT IN ('male', 'female', 'other', 'prefer_not_to_say') THEN
        RAISE EXCEPTION 'Gender selection is required (male, female, other, prefer_not_to_say).';
    END IF;

    -- Update profiles table (never alters auth email)
    UPDATE public.profiles
    SET
        full_name = v_clean_name,
        phone = v_clean_phone,
        updated_at = timezone('utc'::text, now())
    WHERE id = v_actor_id
    RETURNING * INTO v_new_profile;

    -- Lookup linked member record in this church
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
            -- Update ONLY allowed self-service member fields.
            -- Explicitly preserves contact_email, village_name, membership_status, date_of_birth, member_number.
            UPDATE public.members
            SET
                full_name = v_clean_name,
                contact_phone = v_clean_phone,
                gender = v_clean_gender,
                updated_at = timezone('utc'::text, now()),
                updated_by = v_actor_id
            WHERE id = v_member_id
            RETURNING * INTO v_new_member;

            -- Authoritative audit log
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

REVOKE ALL ON FUNCTION public.update_my_member_profile(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_member_profile(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

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

    -- Get trusted email directly from auth.users (never client input)
    SELECT email INTO v_user_email FROM auth.users WHERE id = v_actor_id;
    IF v_user_email IS NULL THEN
        RAISE EXCEPTION 'Authenticated user identity not found.';
    END IF;

    -- Check church is active
    SELECT is_active INTO v_church_active FROM public.churches WHERE id = p_church_id;
    IF v_church_active IS NULL OR NOT v_church_active THEN
        RAISE EXCEPTION 'Selected church does not exist or is inactive.';
    END IF;

    -- Normalize Indian mobile number if supplied
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

    -- If final submission (not draft), validate mandatory fields
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

    -- Check existing active request for this church
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

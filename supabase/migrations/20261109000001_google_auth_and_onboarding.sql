-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - GOOGLE AUTH & ONBOARDING MIGRATION
-- Migration: 20261109000001_google_auth_and_onboarding.sql
-- Non-destructive update for Google OAuth onboarding, Date of Birth,
-- Village / City canonical naming, and field-by-field accountant mapping.
-- ==============================================================================

-- 1. Add date_of_birth to members table if not exists (safe, nullable for historical records)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'members' AND column_name = 'date_of_birth'
    ) THEN
        ALTER TABLE public.members ADD COLUMN date_of_birth DATE;
    END IF;
END $$;

-- 2. Extend access_requests table with onboarding fields
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'access_requests' AND column_name = 'date_of_birth'
    ) THEN
        ALTER TABLE public.access_requests ADD COLUMN date_of_birth DATE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'access_requests' AND column_name = 'gender'
    ) THEN
        ALTER TABLE public.access_requests ADD COLUMN gender TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'access_requests' AND column_name = 'village_name'
    ) THEN
        ALTER TABLE public.access_requests ADD COLUMN village_name TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'access_requests' AND column_name = 'submission_version'
    ) THEN
        ALTER TABLE public.access_requests ADD COLUMN submission_version INT NOT NULL DEFAULT 1;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'access_requests' AND column_name = 'is_draft'
    ) THEN
        ALTER TABLE public.access_requests ADD COLUMN is_draft BOOLEAN NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'access_requests' AND column_name = 'reviewed_fields_snapshot'
    ) THEN
        ALTER TABLE public.access_requests ADD COLUMN reviewed_fields_snapshot JSONB;
    END IF;
END $$;

-- Update check constraint on access_requests status to include draft and returned_for_correction
ALTER TABLE public.access_requests DROP CONSTRAINT IF EXISTS access_requests_status_check;
ALTER TABLE public.access_requests ADD CONSTRAINT access_requests_status_check
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'returned_for_correction', 'suspended'));

-- Ensure unique active request per user & church (draft or pending or returned)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_access_request_per_church
    ON public.access_requests (church_id, user_id)
    WHERE status IN ('draft', 'pending', 'returned_for_correction');

-- 3. RLS POLICIES FOR ONBOARDING REQUESTS
-- Applicants can read and update their own access requests while in draft, pending, or returned status
CREATE POLICY "Applicants can read own access requests"
    ON public.access_requests FOR SELECT
    USING (user_id = auth.uid() OR public.is_platform_admin(auth.uid()) OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant'));

CREATE POLICY "Applicants can update own draft or returned requests"
    ON public.access_requests FOR UPDATE
    USING (user_id = auth.uid() AND status IN ('draft', 'returned_for_correction'));

-- 4. ATOMIC FUNCTION: SUBMIT PROFILE REQUEST
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

        IF p_phone IS NULL OR length(trim(p_phone)) < 6 THEN
            RAISE EXCEPTION 'A valid contact phone number is required.';
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
            applicant_phone = trim(p_phone),
            date_of_birth = p_date_of_birth,
            gender = p_gender,
            village_name = trim(p_village_name),
            is_draft = p_is_draft,
            status = v_status,
            submission_version = v_version,
            requested_at = timezone('utc'::text, now()),
            decision_reason = NULL -- Clear return reason on resubmission
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
            trim(p_phone),
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

-- 5. ATOMIC FUNCTION: APPROVE ACCESS REQUEST V2 (Field-by-Field Mapping & Concurrency)
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
    IF p_final_phone IS NULL OR length(trim(p_final_phone)) < 6 THEN
        RAISE EXCEPTION 'Final reviewed phone number is required.';
    END IF;
    IF p_final_village_name IS NULL OR length(trim(p_final_village_name)) = 0 THEN
        RAISE EXCEPTION 'Final reviewed Village / City Name is required.';
    END IF;
    IF p_final_gender IS NULL OR p_final_gender NOT IN ('male', 'female', 'other', 'prefer_not_to_say') THEN
        RAISE EXCEPTION 'Final reviewed gender must be one of: male, female, other, prefer_not_to_say.';
    END IF;

    IF p_create_new THEN
        -- Create New Member in this church
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
            trim(p_final_phone),
            trim(p_final_contact_email),
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

        -- Update member with reviewed fields.
        -- DO NOT change membership_status (inactive members remain inactive)!
        UPDATE public.members
        SET
            full_name = trim(p_final_full_name),
            contact_phone = trim(p_final_phone),
            contact_email = trim(p_final_contact_email),
            village_name = trim(p_final_village_name),
            gender = p_final_gender,
            date_of_birth = p_final_date_of_birth,
            updated_at = timezone('utc'::text, now()),
            updated_by = v_actor_id
        WHERE id = v_final_member_id;
    END IF;

    -- Ensure 1:1 account linkage in this church
    -- (delete any stale pre-existing link for this user in this church if re-mapping)
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
            'phone', trim(p_final_phone),
            'contact_email', trim(p_final_contact_email),
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

-- 6. ATOMIC FUNCTION: RETURN ACCESS REQUEST FOR CORRECTION
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

    -- Verify Accountant
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

    -- Audit log
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

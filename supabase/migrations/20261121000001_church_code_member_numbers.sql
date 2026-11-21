-- ==============================================================================
-- INCREMENTAL MIGRATION: Church-Code Prefixed New Member IDs & Code Locking
-- File: supabase/migrations/20261121000001_church_code_member_numbers.sql
-- Safe & idempotent for incremental deployment onto an existing database.
-- Note: Canonical full schema snapshot is maintained in supabase/complete_schema.sql.
-- Existing member_number values (e.g. M-0001) are intentionally preserved unchanged.
-- ==============================================================================

-- 1. Normalize churches.code and lock it from changing once members exist
CREATE OR REPLACE FUNCTION public.guard_church_code_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.code := upper(trim(COALESCE(NEW.code, '')));

    IF length(NEW.code) = 0 THEN
        RAISE EXCEPTION 'Church code cannot be empty.';
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

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_church_code_change ON public.churches;
CREATE TRIGGER trg_guard_church_code_change
    BEFORE INSERT OR UPDATE ON public.churches
    FOR EACH ROW EXECUTE FUNCTION public.guard_church_code_change();

-- 2. Sequential <UPPER_CHURCH_CODE>-<N> generator (starts at 1; ignores legacy M-0001 rows)
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

    -- Lock congregation row to serialize concurrent member creation per church
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

-- 3. Authoritative BEFORE INSERT trigger on public.members (does NOT alter existing rows)
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

-- 4. Update approval RPCs so new members get <UPPER_CHURCH_CODE>-<N>
CREATE OR REPLACE FUNCTION public.approve_access_request(
    p_request_id UUID,
    p_member_id UUID DEFAULT NULL,
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
        UPDATE public.members SET contact_email = NULL WHERE id = v_final_member_id;
    ELSE
        v_member_number := public.generate_next_church_member_number(v_req.church_id);

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
            NULL,
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
        IF p_member_id IS NULL THEN
            RAISE EXCEPTION 'Either select an existing member to link or choose Create New Member.';
        END IF;

        SELECT * INTO v_old_member
        FROM public.members
        WHERE id = p_member_id AND church_id = v_target_church_id
        FOR UPDATE;

        IF v_old_member.id IS NULL THEN
            RAISE EXCEPTION 'Target existing member not found in this church.';
        END IF;

        UPDATE public.members
        SET
            full_name = trim(p_final_full_name),
            date_of_birth = p_final_date_of_birth,
            contact_phone = v_clean_phone,
            contact_email = NULL,
            village_name = trim(p_final_village_name),
            gender = p_final_gender,
            updated_by = v_actor_id,
            updated_at = timezone('utc'::text, now())
        WHERE id = p_member_id;

        v_final_member_id := p_member_id;
    END IF;

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
        'Approved by Accountant via side-by-side verification'
    )
    ON CONFLICT (church_id, user_id, role) DO UPDATE SET status = 'approved';

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
            'created_new_member', p_create_new
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
        'access_request.approved_v2',
        'access_request',
        p_request_id::text,
        'Accountant approved member access (' || CASE WHEN p_create_new THEN 'created new member' ELSE 'linked existing member' END || '): ' || trim(p_final_full_name),
        jsonb_build_object(
            'member_id', v_final_member_id,
            'user_id', v_req.user_id,
            'submission_version', v_req.submission_version
        ),
        'Accountant verified fields side-by-side'
    );

    RETURN jsonb_build_object('success', true, 'member_id', v_final_member_id);
END;
$$;

-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - ACCOUNTANT COLLECTOR & STAFF ACCESS MANAGEMENT
-- Migration: 20261115000001_accountant_collector_staff_management.sql
-- 1. Updates get_auth_church_role to prioritize highest privilege role when a
--    church member is also assigned a staff role (e.g. collector).
-- 2. Adds SELECT policy on member_account_links for self & church admin/accountant.
-- 3. Adds SECURITY DEFINER RPCs for Accountants (assign/suspend/restore Collector
--    from active linked church members) and Admins (all staff roles), with audit logs.
-- ==============================================================================

-- 1. Deterministic highest-privilege role lookup per user & church
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

-- 2. Ensure member_account_links has clean SELECT policy
DROP POLICY IF EXISTS "Users and church staff can read member account links" ON public.member_account_links;
CREATE POLICY "Users and church staff can read member account links"
    ON public.member_account_links FOR SELECT
    USING (
        user_id = auth.uid()
        OR public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant')
    );

-- 3. RPC: Fetch church staff assignments + eligible linked church members (+ all profiles for Admins)
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

    -- Fetch church staff assignments (admin, accountant, collector) with profile & optional member link
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

    -- Fetch eligible active church members who have a linked login account
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

    -- Admins / Platform Admins can also assign any existing registered user profile
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

-- 4. RPC: Assign a staff role (Accountant -> Collector from linked active church members only; Admin -> any staff role)
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
        -- Full staff role assignment allowed
        NULL;
    ELSIF v_actor_role = 'accountant' THEN
        -- Accountants can ONLY assign Collectors from active linked members of their church
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

-- 5. RPC: Suspend / Restore a staff access assignment
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

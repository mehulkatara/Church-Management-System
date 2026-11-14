-- ==============================================================================
-- CHURCH MANAGEMENT SYSTEM - MEMBER SELF PROFILE UPDATE RPC
-- Migration: 20261113000001_member_self_profile_update.sql
-- Enforces mandatory full_name, contact_phone, and gender on member self-update,
-- preserves protected columns (village_name, membership_status, date_of_birth,
-- login email), verifies church access, and writes authoritative audit logs.
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
    v_clean_email TEXT;
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

    -- 2. Mandatory Phone Number (normalize whitespace, dashes, parentheses)
    v_clean_phone := regexp_replace(trim(COALESCE(p_contact_phone, '')), '[\s\-()]', '', 'g');
    IF length(v_clean_phone) = 0 THEN
        RAISE EXCEPTION 'Phone number is required.';
    END IF;
    IF v_clean_phone !~ '^\+?[0-9]{6,15}$' THEN
        RAISE EXCEPTION 'Please enter a valid phone number (6 to 15 digits).';
    END IF;

    -- 3. Mandatory Gender
    v_clean_gender := lower(trim(COALESCE(p_gender, '')));
    IF v_clean_gender NOT IN ('male', 'female', 'other', 'prefer_not_to_say') THEN
        RAISE EXCEPTION 'Gender selection is required (male, female, other, prefer_not_to_say).';
    END IF;

    -- 4. Optional Contact Email (separate from authentication login email)
    v_clean_email := NULLIF(trim(COALESCE(p_contact_email, '')), '');
    IF v_clean_email IS NOT NULL AND v_clean_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
        RAISE EXCEPTION 'Please enter a valid contact email address.';
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
            -- Explicitly preserves village_name, membership_status, date_of_birth, member_number.
            UPDATE public.members
            SET
                full_name = v_clean_name,
                contact_phone = v_clean_phone,
                gender = v_clean_gender,
                contact_email = v_clean_email,
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
                'Member updated their own profile details (name, phone, gender)',
                jsonb_build_object(
                    'full_name', v_old_member.full_name,
                    'contact_phone', v_old_member.contact_phone,
                    'contact_email', v_old_member.contact_email,
                    'gender', v_old_member.gender
                ),
                jsonb_build_object(
                    'full_name', v_new_member.full_name,
                    'contact_phone', v_new_member.contact_phone,
                    'contact_email', v_new_member.contact_email,
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

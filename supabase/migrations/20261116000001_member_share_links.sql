-- ==============================================================================
-- INCREMENTAL MIGRATION: Single-Use Member Portal Share Links
-- File: supabase/migrations/20261116000001_member_share_links.sql
-- Safe & idempotent for incremental deployment onto an existing database.
-- Note: Canonical full schema snapshot is maintained in supabase/complete_schema.sql.
-- ==============================================================================

-- 1. Enable cryptographic hashing extension (SHA-256 & random bytes)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. MEMBER SHARE LINKS TABLE
CREATE TABLE IF NOT EXISTS public.member_share_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'revoked')),
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_member_share_links_member
    ON public.member_share_links(church_id, member_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_member_share_links_one_active
    ON public.member_share_links(church_id, member_id)
    WHERE status = 'active';

-- 3. ENABLE ROW LEVEL SECURITY & POLICIES
ALTER TABLE public.member_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Church staff can view member share links" ON public.member_share_links;
CREATE POLICY "Church staff can view member share links"
    ON public.member_share_links FOR SELECT
    USING (
        public.is_platform_admin(auth.uid())
        OR public.get_auth_church_role(church_id, auth.uid()) IN ('admin', 'accountant', 'collector')
    );

-- 4. SECURITY DEFINER RPCS
-- Create a single-use link (Admin, Accountant, Collector, or Platform Admin)
CREATE OR REPLACE FUNCTION public.create_member_share_link(
    p_church_id UUID,
    p_member_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_member RECORD;
    v_raw_token TEXT;
    v_token_hash TEXT;
    v_link RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF p_church_id IS NULL OR p_member_id IS NULL THEN
        RAISE EXCEPTION 'Church and member are required.';
    END IF;

    IF public.is_platform_admin(v_actor_id) THEN
        v_role := 'admin';
    ELSE
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
    END IF;

    IF v_role NOT IN ('admin', 'accountant', 'collector') THEN
        RAISE EXCEPTION 'Unauthorized: Only church staff can generate member portal links.';
    END IF;

    SELECT * INTO v_member
    FROM public.members
    WHERE id = p_member_id AND church_id = p_church_id;

    IF v_member.id IS NULL THEN
        RAISE EXCEPTION 'Member not found in this church.';
    END IF;

    -- Supersede any previously active unconsumed link for this member
    UPDATE public.member_share_links
    SET
        status = 'revoked',
        revoked_at = timezone('utc'::text, now()),
        revoked_by = v_actor_id
    WHERE church_id = p_church_id
      AND member_id = p_member_id
      AND status = 'active';

    -- Generate 256-bit cryptographically random token and store only its SHA-256 hash
    v_raw_token := encode(gen_random_bytes(32), 'hex');
    v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

    INSERT INTO public.member_share_links (
        church_id,
        member_id,
        token_hash,
        status,
        created_by
    ) VALUES (
        p_church_id,
        p_member_id,
        v_token_hash,
        'active',
        v_actor_id
    )
    RETURNING * INTO v_link;

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
        'member.share_link_created',
        'member_share_link',
        v_link.id::text,
        'Generated single-use view-only portal link for member ' || v_member.full_name || ' (' || v_member.member_number || ')',
        jsonb_build_object('member_id', p_member_id, 'link_id', v_link.id, 'status', 'active'),
        'Staff generated single-use member link'
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', v_link.id,
        'raw_token', v_raw_token,
        'status', v_link.status,
        'created_at', v_link.created_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_member_share_link(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_member_share_link(UUID, UUID) TO authenticated;

-- Revoke an active single-use member portal link (Admin, Accountant, Collector, or Platform Admin)
CREATE OR REPLACE FUNCTION public.revoke_member_share_link(
    p_church_id UUID,
    p_link_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_link RECORD;
    v_updated RECORD;
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
        RAISE EXCEPTION 'Unauthorized: Only church staff can revoke member portal links.';
    END IF;

    SELECT * INTO v_link
    FROM public.member_share_links
    WHERE id = p_link_id AND church_id = p_church_id
    FOR UPDATE;

    IF v_link.id IS NULL THEN
        RAISE EXCEPTION 'Member share link not found in this church.';
    END IF;

    IF v_link.status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', true,
            'link_id', v_link.id,
            'status', v_link.status
        );
    END IF;

    UPDATE public.member_share_links
    SET
        status = 'revoked',
        revoked_at = timezone('utc'::text, now()),
        revoked_by = v_actor_id
    WHERE id = v_link.id
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
        'member.share_link_revoked',
        'member_share_link',
        v_updated.id::text,
        'Revoked active single-use member portal link',
        jsonb_build_object('status', v_link.status, 'member_id', v_link.member_id),
        jsonb_build_object('status', v_updated.status, 'revoked_at', v_updated.revoked_at),
        'Staff revoked member share link'
    );

    RETURN jsonb_build_object(
        'success', true,
        'link_id', v_updated.id,
        'status', v_updated.status,
        'revoked_at', v_updated.revoked_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_member_share_link(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_member_share_link(UUID, UUID) TO authenticated;

-- Redeem a single-use member portal link without authentication (expires immediately on first open)
CREATE OR REPLACE FUNCTION public.redeem_member_share_link(
    p_raw_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_clean_token TEXT := trim(COALESCE(p_raw_token, ''));
    v_token_hash TEXT;
    v_link RECORD;
    v_consumed_at TIMESTAMPTZ;
    v_church RECORD;
    v_member RECORD;
    v_donations JSONB;
    v_mask_names BOOLEAN := true;
    v_setting_value JSONB;
    v_leaderboard_fys JSONB;
BEGIN
    IF length(v_clean_token) < 16 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'invalid',
            'message', 'This member link is invalid or incomplete.'
        );
    END IF;

    v_token_hash := encode(digest(v_clean_token, 'sha256'), 'hex');

    SELECT * INTO v_link
    FROM public.member_share_links
    WHERE token_hash = v_token_hash
    FOR UPDATE;

    IF v_link.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'invalid',
            'message', 'This member link is invalid or does not exist.'
        );
    END IF;

    IF v_link.status = 'revoked' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'revoked',
            'message', 'This member link was revoked or replaced by church staff. Please request a fresh link.'
        );
    END IF;

    IF v_link.status = 'consumed' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'already_used',
            'message', 'This single-use link has already been opened and expired. Please ask your church staff for a new link.'
        );
    END IF;

    v_consumed_at := timezone('utc'::text, now());

    UPDATE public.member_share_links
    SET
        status = 'consumed',
        consumed_at = v_consumed_at
    WHERE id = v_link.id;

    SELECT id, code, name, address, phone
    INTO v_church
    FROM public.churches
    WHERE id = v_link.church_id;

    SELECT
        id,
        church_id,
        member_number,
        full_name,
        contact_phone,
        village_name,
        gender,
        date_of_birth,
        joining_date,
        membership_status
    INTO v_member
    FROM public.members
    WHERE id = v_link.member_id AND church_id = v_link.church_id;

    IF v_member.id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'invalid',
            'message', 'Associated member record could not be found.'
        );
    END IF;

    SELECT setting_value INTO v_setting_value
    FROM public.church_settings
    WHERE church_id = v_link.church_id AND setting_key = 'leaderboard';

    IF v_setting_value IS NOT NULL AND v_setting_value ? 'mask_names_by_default' THEN
        v_mask_names := COALESCE((v_setting_value ->> 'mask_names_by_default')::boolean, true);
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', d.id,
            'receipt_number', d.receipt_number,
            'donation_date', d.donation_date,
            'amount', d.amount,
            'payment_method', d.payment_method,
            'payment_reference', d.payment_reference,
            'notes', d.notes,
            'category_name', COALESCE(dc.name, 'General'),
            'receiving_account_name', COALESCE(ra.account_name, '')
        )
        ORDER BY d.donation_date DESC, d.created_at DESC
    ), '[]'::jsonb)
    INTO v_donations
    FROM public.donations d
    LEFT JOIN public.donation_categories dc ON dc.id = d.category_id
    LEFT JOIN public.receiving_accounts ra ON ra.id = d.receiving_account_id
    WHERE d.church_id = v_link.church_id
      AND d.member_id = v_link.member_id
      AND d.deleted_at IS NULL;

    -- Build server-masked competition rankings grouped by Indian Financial Year (Apr 1 - Mar 31)
    WITH fy_donations AS (
        SELECT
            d.member_id,
            m.full_name,
            m.member_number,
            (m.membership_status = 'active') AS is_active,
            CASE
                WHEN EXTRACT(MONTH FROM d.donation_date) >= 4 THEN EXTRACT(YEAR FROM d.donation_date)::INT
                ELSE EXTRACT(YEAR FROM d.donation_date)::INT - 1
            END AS fy_start_year,
            d.amount
        FROM public.donations d
        JOIN public.members m ON m.id = d.member_id AND m.church_id = d.church_id
        WHERE d.church_id = v_link.church_id
          AND d.deleted_at IS NULL
    ),
    fy_totals AS (
        SELECT
            fy_start_year,
            (fy_start_year::text || '-' || right((fy_start_year + 1)::text, 2)) AS fy_code,
            member_id,
            full_name,
            member_number,
            is_active,
            SUM(amount)::NUMERIC(14, 2) AS total_amount
        FROM fy_donations
        GROUP BY fy_start_year, member_id, full_name, member_number, is_active
    ),
    ranked AS (
        SELECT
            fy_start_year,
            fy_code,
            member_id,
            full_name,
            member_number,
            is_active,
            total_amount,
            (member_id = v_link.member_id) AS is_self,
            RANK() OVER (PARTITION BY fy_code ORDER BY total_amount DESC)::INT AS donor_rank,
            ROW_NUMBER() OVER (PARTITION BY fy_code ORDER BY total_amount DESC, full_name ASC, member_id ASC)::INT AS sort_idx
        FROM fy_totals
    ),
    formatted AS (
        SELECT
            fy_start_year,
            fy_code,
            donor_rank,
            sort_idx,
            total_amount,
            is_active,
            is_self,
            CASE
                WHEN is_self OR NOT v_mask_names THEN full_name
                WHEN strpos(trim(full_name), ' ') = 0 THEN left(trim(full_name), 1) || '***'
                ELSE split_part(trim(full_name), ' ', 1) || ' ' || left(reverse(split_part(reverse(trim(full_name)), ' ', 1)), 1) || '***'
            END AS display_name,
            CASE
                WHEN is_self OR NOT v_mask_names THEN member_number
                ELSE '••••'
            END AS display_member_number
        FROM ranked
    ),
    fy_summaries AS (
        SELECT
            fy_start_year,
            fy_code,
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'rank', f2.donor_rank,
                            'display_name', f2.display_name,
                            'display_member_number', f2.display_member_number,
                            'total_amount', f2.total_amount,
                            'is_active', f2.is_active,
                            'is_self', f2.is_self
                        )
                        ORDER BY f2.sort_idx
                    )
                    FROM formatted f2
                    WHERE f2.fy_code = f.fy_code AND f2.sort_idx <= 10
                ),
                '[]'::jsonb
            ) AS top_10,
            (
                SELECT jsonb_build_object(
                    'rank', f3.donor_rank,
                    'display_name', f3.display_name,
                    'display_member_number', f3.display_member_number,
                    'total_amount', f3.total_amount,
                    'is_active', f3.is_active,
                    'is_self', true
                )
                FROM formatted f3
                WHERE f3.fy_code = f.fy_code AND f3.is_self = true
                LIMIT 1
            ) AS my_standing
        FROM (SELECT DISTINCT fy_start_year, fy_code FROM formatted) f
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'fy_code', fy_code,
            'top_10', top_10,
            'my_standing', my_standing
        )
        ORDER BY fy_start_year DESC
    ), '[]'::jsonb)
    INTO v_leaderboard_fys
    FROM fy_summaries;

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
        v_link.church_id,
        NULL,
        'member.share_link_opened',
        'member_share_link',
        v_link.id::text,
        'Member opened single-use view-only portal link (' || v_member.member_number || ')',
        jsonb_build_object('member_id', v_member.id, 'consumed_at', v_consumed_at),
        'Single-use member link redeemed'
    );

    RETURN jsonb_build_object(
        'success', true,
        'consumed_at', v_consumed_at,
        'mask_names_by_default', v_mask_names,
        'church', jsonb_build_object(
            'id', v_church.id,
            'code', v_church.code,
            'name', v_church.name,
            'address', v_church.address,
            'phone', v_church.phone
        ),
        'member', jsonb_build_object(
            'id', v_member.id,
            'member_number', v_member.member_number,
            'full_name', v_member.full_name,
            'contact_phone', v_member.contact_phone,
            'village_name', v_member.village_name,
            'gender', v_member.gender,
            'date_of_birth', v_member.date_of_birth,
            'joining_date', v_member.joining_date,
            'membership_status', v_member.membership_status
        ),
        'donations', v_donations,
        'leaderboard_fys', v_leaderboard_fys
    );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_member_share_link(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_member_share_link(TEXT) TO anon, authenticated;

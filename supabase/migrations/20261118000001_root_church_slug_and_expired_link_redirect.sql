-- ==============================================================================
-- INCREMENTAL MIGRATION: Root-Level Church URLs (/<slug>) & Expired Link Church Sign-In
-- File: supabase/migrations/20261118000001_root_church_slug_and_expired_link_redirect.sql
-- Safe & idempotent for incremental deployment onto an existing database.
-- Note: Canonical full schema snapshot is maintained in supabase/complete_schema.sql.
-- ==============================================================================

-- 1. Guard all reserved root application routes in live slug availability checks
CREATE OR REPLACE FUNCTION public.check_church_slug_availability(
    p_slug TEXT,
    p_exclude_church_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_clean TEXT;
    v_exists BOOLEAN;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_clean := trim(both '-' from regexp_replace(lower(COALESCE(p_slug, '')), '[^a-z0-9]+', '-', 'g'));

    IF length(v_clean) < 2 OR length(v_clean) > 64 OR v_clean !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
        RETURN jsonb_build_object(
            'available', false,
            'normalized_slug', v_clean,
            'reason', 'Slug must be 2–64 characters using lowercase letters, numbers, and hyphens only.'
        );
    END IF;

    IF v_clean = ANY(ARRAY[
        'home',
        'privacy',
        'privacy-policy',
        'terms',
        'terms-of-service',
        'member-portal',
        'api',
        'auth',
        'login',
        'c',
        'assets',
        'favicon-ico',
        'robots-txt'
    ]) THEN
        RETURN jsonb_build_object(
            'available', false,
            'normalized_slug', v_clean,
            'reason', '"' || v_clean || '" is a reserved application route. Please choose another slug.'
        );
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.churches c
        WHERE lower(c.slug) = v_clean
          AND (p_exclude_church_id IS NULL OR c.id <> p_exclude_church_id)
    ) INTO v_exists;

    RETURN jsonb_build_object(
        'available', NOT v_exists,
        'normalized_slug', v_clean,
        'reason', CASE WHEN v_exists THEN 'This URL slug is already in use by another church.' ELSE NULL END
    );
END;
$$;

REVOKE ALL ON FUNCTION public.check_church_slug_availability(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_church_slug_availability(TEXT, UUID) TO authenticated;

-- 2. Return public church identity (id, code, slug, name) on expired/revoked single-use
--    member portal links without exposing any member profile or financial data.
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
    v_church_public JSONB;
    v_member RECORD;
    v_donations JSONB;
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

    SELECT id, code, slug, name, address, phone
    INTO v_church
    FROM public.churches
    WHERE id = v_link.church_id;

    IF v_church.id IS NOT NULL THEN
        v_church_public := jsonb_build_object(
            'id', v_church.id,
            'code', v_church.code,
            'slug', v_church.slug,
            'name', v_church.name
        );
    ELSE
        v_church_public := NULL;
    END IF;

    IF v_link.status = 'revoked' THEN
        RETURN jsonb_strip_nulls(jsonb_build_object(
            'success', false,
            'error_code', 'revoked',
            'message', 'This member link was revoked or replaced by church staff. Please request a fresh link or sign in to your church account.',
            'church', v_church_public
        ));
    END IF;

    IF v_link.status = 'consumed' THEN
        RETURN jsonb_strip_nulls(jsonb_build_object(
            'success', false,
            'error_code', 'already_used',
            'message', 'This single-use link has already been opened and expired. Please ask your church staff for a new link or sign in to your church account.',
            'church', v_church_public
        ));
    END IF;

    v_consumed_at := timezone('utc'::text, now());

    UPDATE public.member_share_links
    SET
        status = 'consumed',
        consumed_at = v_consumed_at
    WHERE id = v_link.id;

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

    -- Build competition rankings grouped by Indian Financial Year (Apr 1 - Mar 31)
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
            full_name AS display_name,
            member_number AS display_member_number
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
        'church', jsonb_build_object(
            'id', v_church.id,
            'code', v_church.code,
            'slug', v_church.slug,
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

-- ==============================================================================
-- MIGRATION: Make donation_categories.code optional/unconstrained & filter
--            Member Portal leaderboard to active members only
-- File: supabase/migrations/20261121000003_category_code_optional_and_active_leaderboard.sql
-- ==============================================================================

-- 1. Remove Category Code requirement and uniqueness constraint on donation_categories
ALTER TABLE public.donation_categories
    DROP CONSTRAINT IF EXISTS uq_church_category_code;

ALTER TABLE public.donation_categories
    ALTER COLUMN code DROP NOT NULL;

-- 2. Restrict Member Portal leaderboard standings to active church members only
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
    -- Active church members only
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
          AND m.membership_status = 'active'
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

-- ==============================================================================
-- MIGRATION: Plan B Automatic SMS Delivery via capcom6/android-sms-gateway
-- File: supabase/migrations/20261121000004_android_sms_gateway_plan_b.sql
-- ==============================================================================

-- 1. Private table for per-church Android SMS Gateway credentials
--    RLS is enabled with zero direct client policies so passwords never leave the server.
CREATE TABLE IF NOT EXISTS public.church_sms_gateways (
    church_id UUID PRIMARY KEY REFERENCES public.churches(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT true,
    api_url TEXT NOT NULL DEFAULT 'https://api.sms-gate.app/3rdparty/v1',
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    device_id TEXT,
    sim_number SMALLINT CHECK (sim_number IN (1, 2)),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.church_sms_gateways ENABLE ROW LEVEL SECURITY;

-- 2. Migrate any existing sms_provider church_settings rows away from Mode A
UPDATE public.church_settings
SET
    setting_value = jsonb_build_object(
        'mode', 'android_sms_gateway',
        'provider_enabled', COALESCE((setting_value ->> 'provider_enabled')::boolean, false)
    ),
    updated_at = timezone('utc'::text, now())
WHERE setting_key = 'sms_provider';

-- 3. Staff-safe read RPC (returns gateway configuration status WITHOUT password)
CREATE OR REPLACE FUNCTION public.get_church_sms_gateway_status(
    p_church_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_row RECORD;
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT public.is_platform_admin(v_actor_id) THEN
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
        IF v_role IS NULL OR v_role NOT IN ('admin', 'accountant', 'collector') THEN
            RAISE EXCEPTION 'Only authorized church staff can view SMS gateway settings.';
        END IF;
    END IF;

    SELECT
        church_id,
        enabled,
        api_url,
        username,
        (length(trim(COALESCE(password, ''))) > 0) AS has_password,
        device_id,
        sim_number,
        updated_at
    INTO v_row
    FROM public.church_sms_gateways
    WHERE church_id = p_church_id;

    IF v_row.church_id IS NULL THEN
        RETURN jsonb_build_object(
            'configured', false,
            'enabled', false,
            'provider', 'android_sms_gateway',
            'api_url', 'https://api.sms-gate.app/3rdparty/v1',
            'username', NULL,
            'has_password', false,
            'device_id', NULL,
            'sim_number', NULL,
            'updated_at', NULL
        );
    END IF;

    RETURN jsonb_build_object(
        'configured', true,
        'enabled', v_row.enabled,
        'provider', 'android_sms_gateway',
        'api_url', v_row.api_url,
        'username', v_row.username,
        'has_password', v_row.has_password,
        'device_id', v_row.device_id,
        'sim_number', v_row.sim_number,
        'updated_at', v_row.updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_church_sms_gateway_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_church_sms_gateway_status(UUID) TO authenticated;

-- 4. Admin / Accountant write RPC to configure per-church Android SMS Gateway credentials
CREATE OR REPLACE FUNCTION public.upsert_church_sms_gateway(
    p_church_id UUID,
    p_enabled BOOLEAN DEFAULT true,
    p_api_url TEXT DEFAULT 'https://api.sms-gate.app/3rdparty/v1',
    p_username TEXT DEFAULT '',
    p_password TEXT DEFAULT '',
    p_device_id TEXT DEFAULT NULL,
    p_sim_number INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_role TEXT;
    v_clean_url TEXT;
    v_host TEXT;
    v_clean_user TEXT;
    v_clean_pass TEXT;
    v_clean_device TEXT;
    v_existing_pass TEXT;
    v_final_pass TEXT;
    v_sim SMALLINT;
    v_enabled BOOLEAN := COALESCE(p_enabled, true);
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF NOT public.is_platform_admin(v_actor_id) THEN
        v_role := public.get_auth_church_role(p_church_id, v_actor_id);
        IF v_role IS NULL OR v_role NOT IN ('admin', 'accountant') THEN
            RAISE EXCEPTION 'Only Church Admins or Accountants can configure SMS Gateway settings.';
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.churches WHERE id = p_church_id) THEN
        RAISE EXCEPTION 'Church not found.';
    END IF;

    v_clean_url := regexp_replace(trim(COALESCE(p_api_url, '')), '/+$', '');
    IF v_clean_url = '' THEN
        v_clean_url := 'https://api.sms-gate.app/3rdparty/v1';
    END IF;

    IF v_clean_url !~* '^https://[a-z0-9.-]+(?::[0-9]{1,5})?(?:/[^[:space:]]*)?$' THEN
        RAISE EXCEPTION 'Gateway URL must be a valid HTTPS URL (for example, https://api.sms-gate.app/3rdparty/v1).';
    END IF;

    v_host := lower(split_part(split_part(regexp_replace(v_clean_url, '^https://', '', 'i'), '/', 1), ':', 1));
    IF v_host = ''
        OR v_host IN ('localhost', '0.0.0.0', '[::1]', '::1')
        OR v_host ~ '\.(local|internal|localhost)$'
        OR v_host ~ '^127\.'
        OR v_host ~ '^10\.'
        OR v_host ~ '^192\.168\.'
        OR v_host ~ '^169\.254\.'
        OR v_host ~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.'
    THEN
        RAISE EXCEPTION 'Private, loopback, and link-local hosts are not allowed for the Cloud Gateway URL.';
    END IF;

    v_clean_user := trim(COALESCE(p_username, ''));
    IF v_clean_user = '' THEN
        RAISE EXCEPTION 'Gateway username is required.';
    END IF;

    IF p_sim_number IS NOT NULL AND p_sim_number NOT IN (1, 2) THEN
        RAISE EXCEPTION 'SIM slot must be 1, 2, or left automatic.';
    END IF;
    v_sim := p_sim_number::SMALLINT;
    v_clean_device := NULLIF(trim(COALESCE(p_device_id, '')), '');
    v_clean_pass := trim(COALESCE(p_password, ''));

    SELECT password INTO v_existing_pass
    FROM public.church_sms_gateways
    WHERE church_id = p_church_id;

    IF v_clean_pass = '' THEN
        IF v_existing_pass IS NULL OR trim(v_existing_pass) = '' THEN
            RAISE EXCEPTION 'Gateway password is required for initial setup.';
        END IF;
        v_final_pass := v_existing_pass;
    ELSE
        v_final_pass := v_clean_pass;
    END IF;

    INSERT INTO public.church_sms_gateways (
        church_id,
        enabled,
        api_url,
        username,
        password,
        device_id,
        sim_number,
        updated_at,
        updated_by
    ) VALUES (
        p_church_id,
        v_enabled,
        v_clean_url,
        v_clean_user,
        v_final_pass,
        v_clean_device,
        v_sim,
        v_now,
        v_actor_id
    )
    ON CONFLICT (church_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        api_url = EXCLUDED.api_url,
        username = EXCLUDED.username,
        password = EXCLUDED.password,
        device_id = EXCLUDED.device_id,
        sim_number = EXCLUDED.sim_number,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;

    INSERT INTO public.church_settings (
        church_id,
        setting_key,
        setting_value,
        updated_at,
        updated_by
    ) VALUES (
        p_church_id,
        'sms_provider',
        jsonb_build_object(
            'mode', 'android_sms_gateway',
            'provider_enabled', v_enabled
        ),
        v_now,
        v_actor_id
    )
    ON CONFLICT (church_id, setting_key) DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by;

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
        'church.sms_gateway_updated',
        'church_sms_gateway',
        p_church_id::text,
        'Updated Android SMS Gateway configuration (' || v_clean_url || ', enabled=' || v_enabled || ')',
        jsonb_build_object(
            'provider', 'android_sms_gateway',
            'enabled', v_enabled,
            'api_url', v_clean_url,
            'username', v_clean_user,
            'device_id', v_clean_device,
            'sim_number', v_sim
        ),
        'Church SMS Gateway settings updated'
    );

    RETURN jsonb_build_object(
        'configured', true,
        'enabled', v_enabled,
        'provider', 'android_sms_gateway',
        'api_url', v_clean_url,
        'username', v_clean_user,
        'has_password', true,
        'device_id', v_clean_device,
        'sim_number', v_sim,
        'updated_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_church_sms_gateway(UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_church_sms_gateway(UUID, BOOLEAN, TEXT, TEXT, TEXT, TEXT, INT) TO authenticated;

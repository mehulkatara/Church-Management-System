-- ==============================================================================
-- INCREMENTAL MIGRATION: Strict Church Creation Mandatory Fields & Code Format
-- File: supabase/migrations/20261121000002_strict_church_creation_fields_and_code.sql
-- Safe & idempotent for incremental deployment onto an existing database.
-- Note: Canonical full schema snapshot is maintained in supabase/complete_schema.sql.
-- Enforces all mandatory fields & strict code format on newly created churches
-- (and code format on code edits) while keeping existing historical rows safe.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.guard_church_code_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_phone TEXT;
BEGIN
    NEW.code := upper(trim(COALESCE(NEW.code, '')));

    IF length(NEW.code) = 0 THEN
        RAISE EXCEPTION 'Church code cannot be empty.';
    END IF;

    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM upper(trim(OLD.code))) THEN
        IF length(NEW.code) < 2 OR length(NEW.code) > 20 OR NEW.code !~ '^[A-Z0-9]+(?:-[A-Z0-9]+)*$' THEN
            RAISE EXCEPTION 'Church code must be 2–20 characters using uppercase letters, numbers, and single inner hyphens (-) only.';
        END IF;
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

    IF TG_OP = 'INSERT' THEN
        NEW.name := trim(COALESCE(NEW.name, ''));
        IF length(NEW.name) = 0 THEN
            RAISE EXCEPTION 'Church name is required.';
        END IF;

        NEW.address := trim(COALESCE(NEW.address, ''));
        IF length(NEW.address) = 0 THEN
            RAISE EXCEPTION 'Church address is required.';
        END IF;

        v_clean_phone := regexp_replace(trim(COALESCE(NEW.phone, '')), '[\s\-()]', '', 'g');
        IF v_clean_phone ~ '^\+91[0-9]{10}$' THEN
            v_clean_phone := substr(v_clean_phone, 4);
        ELSIF v_clean_phone ~ '^91[0-9]{10}$' THEN
            v_clean_phone := substr(v_clean_phone, 3);
        ELSIF v_clean_phone ~ '^0[0-9]{10}$' THEN
            v_clean_phone := substr(v_clean_phone, 2);
        END IF;

        IF v_clean_phone !~ '^[6-9][0-9]{9}$' OR v_clean_phone ~ '^([0-9])\1{9}$' THEN
            RAISE EXCEPTION 'Church phone must be a valid 10-digit Indian mobile number.';
        END IF;
        NEW.phone := v_clean_phone;

        NEW.email := lower(trim(COALESCE(NEW.email, '')));
        IF length(NEW.email) = 0 OR NEW.email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
            RAISE EXCEPTION 'A valid church email address is required.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_church_code_change ON public.churches;
CREATE TRIGGER trg_guard_church_code_change
    BEFORE INSERT OR UPDATE ON public.churches
    FOR EACH ROW EXECUTE FUNCTION public.guard_church_code_change();

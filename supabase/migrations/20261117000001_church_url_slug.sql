-- ==============================================================================
-- INCREMENTAL MIGRATION: Church-Specific Custom Editable URL Slugs (/c/<slug>)
-- File: supabase/migrations/20261117000001_church_url_slug.sql
-- Safe & idempotent for incremental deployment onto an existing database.
-- Note: Canonical full schema snapshot is maintained in supabase/complete_schema.sql.
-- ==============================================================================

-- 1. Add slug column (nullable initially for safe backfill on existing databases)
ALTER TABLE public.churches
    ADD COLUMN IF NOT EXISTS slug TEXT;

-- 2. Backfill clean, unique lowercase kebab-case slugs for all existing churches
DO $$
DECLARE
    v_church RECORD;
    v_base TEXT;
    v_candidate TEXT;
    v_suffix INT;
BEGIN
    FOR v_church IN
        SELECT id, code, name, slug
        FROM public.churches
        ORDER BY created_at ASC, id ASC
    LOOP
        v_base := trim(both '-' from regexp_replace(
            lower(COALESCE(NULLIF(trim(v_church.slug), ''), NULLIF(trim(v_church.code), ''), trim(v_church.name), 'church')),
            '[^a-z0-9]+',
            '-',
            'g'
        ));

        IF length(v_base) < 2 THEN
            v_base := 'church-' || substr(replace(v_church.id::text, '-', ''), 1, 6);
        END IF;

        IF length(v_base) > 58 THEN
            v_base := trim(both '-' from left(v_base, 58));
        END IF;

        v_candidate := v_base;
        v_suffix := 2;

        WHILE EXISTS (
            SELECT 1 FROM public.churches c
            WHERE c.id <> v_church.id
              AND lower(COALESCE(c.slug, '')) = lower(v_candidate)
        ) LOOP
            v_candidate := v_base || '-' || v_suffix::text;
            v_suffix := v_suffix + 1;
        END LOOP;

        IF v_church.slug IS DISTINCT FROM v_candidate THEN
            UPDATE public.churches
            SET slug = v_candidate
            WHERE id = v_church.id;
        END IF;
    END LOOP;
END;
$$;

-- 3. Enforce NOT NULL, URL-safe kebab-case format constraint, and case-insensitive uniqueness
ALTER TABLE public.churches
    ALTER COLUMN slug SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_churches_slug_format'
          AND conrelid = 'public.churches'::regclass
    ) THEN
        ALTER TABLE public.churches
            ADD CONSTRAINT chk_churches_slug_format
            CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) BETWEEN 2 AND 64);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_churches_slug
    ON public.churches (lower(slug));

-- 4. Normalization trigger on insert/update
CREATE OR REPLACE FUNCTION public.normalize_church_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_source TEXT;
BEGIN
    v_source := COALESCE(NULLIF(trim(NEW.slug), ''), NULLIF(trim(NEW.code), ''), trim(NEW.name));
    NEW.slug := trim(both '-' from regexp_replace(lower(COALESCE(v_source, '')), '[^a-z0-9]+', '-', 'g'));

    IF TG_OP = 'UPDATE' THEN
        NEW.updated_at := timezone('utc'::text, now());
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_church_slug ON public.churches;
CREATE TRIGGER trg_normalize_church_slug
    BEFORE INSERT OR UPDATE ON public.churches
    FOR EACH ROW EXECUTE FUNCTION public.normalize_church_slug();

-- 5. Live slug availability check RPC for admins & accountants
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

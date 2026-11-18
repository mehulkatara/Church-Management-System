import { supabase, supabaseConfig } from './supabase';
import type { Church } from '../types/database';
import { validateChurchSlug, suggestChurchSlug } from './domain-logic';

const PREVIEW_CHURCHES_KEY = 'cms_preview_churches';
export const SCOPED_CHURCH_SLUG_SESSION_KEY = 'cms_scoped_church_slug';
export const SCOPED_CHURCH_OAUTH_KEY = 'cms_oauth_scoped_church_slug';

export const DEFAULT_PREVIEW_CHURCHES: Church[] = [
  {
    id: 'c1111111-1111-1111-1111-111111111111',
    code: 'BETHEL',
    slug: 'bethel',
    name: 'Bethel Christian Assembly',
    address: '14 Anna Salai, Chennai',
    phone: '+91 44 2811 0000',
    email: 'admin@bethel.org',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'c2222222-2222-2222-2222-222222222222',
    code: 'GRACE',
    slug: 'grace-bethel',
    name: 'Grace Fellowship Church',
    address: '88 Ring Road, Bangalore',
    phone: '+91 80 2555 1234',
    email: 'office@grace.org',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

export function getPreviewChurches(): Church[] {
  if (typeof window === 'undefined') return DEFAULT_PREVIEW_CHURCHES;
  try {
    const raw = window.localStorage.getItem(PREVIEW_CHURCHES_KEY);
    if (!raw) return DEFAULT_PREVIEW_CHURCHES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as Church[];
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_PREVIEW_CHURCHES;
}

export function savePreviewChurches(churches: Church[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREVIEW_CHURCHES_KEY, JSON.stringify(churches));
  } catch {
    // ignore
  }
}

export function persistScopedChurchSlug(slug: string | null, includeOAuthHandoff = false): void {
  if (typeof window === 'undefined') return;
  try {
    if (slug) {
      window.sessionStorage.setItem(SCOPED_CHURCH_SLUG_SESSION_KEY, slug);
      if (includeOAuthHandoff) {
        window.localStorage.setItem(SCOPED_CHURCH_OAUTH_KEY, slug);
      }
    } else {
      window.sessionStorage.removeItem(SCOPED_CHURCH_SLUG_SESSION_KEY);
      window.localStorage.removeItem(SCOPED_CHURCH_OAUTH_KEY);
    }
  } catch {
    // ignore
  }
}

export function consumeOAuthScopedChurchSlug(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const oauthSlug = window.localStorage.getItem(SCOPED_CHURCH_OAUTH_KEY);
    if (oauthSlug) {
      window.localStorage.removeItem(SCOPED_CHURCH_OAUTH_KEY);
      return suggestChurchSlug(oauthSlug) || null;
    }
    const sessionSlug = window.sessionStorage.getItem(SCOPED_CHURCH_SLUG_SESSION_KEY);
    return sessionSlug ? suggestChurchSlug(sessionSlug) || null : null;
  } catch {
    return null;
  }
}

export async function resolveActiveChurchBySlug(rawSlug: string): Promise<Church | null> {
  const validation = validateChurchSlug(rawSlug);
  if (!validation.valid) return null;

  if (supabase && supabaseConfig.isConfigured) {
    try {
      const { data, error } = await supabase
        .from('churches')
        .select('*')
        .eq('slug', validation.normalized)
        .eq('is_active', true)
        .maybeSingle();

      if (!error && data) {
        return data as Church;
      }
      return null;
    } catch {
      return null;
    }
  }

  return (
    getPreviewChurches().find(
      (c) => c.slug.toLowerCase() === validation.normalized && c.is_active
    ) || null
  );
}

export async function checkChurchSlugAvailability(
  rawSlug: string,
  excludeChurchId?: string | null
): Promise<{
  available: boolean;
  normalizedSlug: string;
  reason?: string;
}> {
  const validation = validateChurchSlug(rawSlug);
  if (!validation.valid) {
    return {
      available: false,
      normalizedSlug: validation.normalized,
      reason: validation.error,
    };
  }

  if (supabase && supabaseConfig.isConfigured) {
    try {
      const { data, error } = await supabase.rpc('check_church_slug_availability', {
        p_slug: validation.normalized,
        p_exclude_church_id: excludeChurchId || null,
      });

      if (!error && data && typeof data === 'object') {
        const res = data as {
          available?: boolean;
          normalized_slug?: string;
          reason?: string | null;
        };
        return {
          available: Boolean(res.available),
          normalizedSlug: res.normalized_slug || validation.normalized,
          reason: res.reason || undefined,
        };
      }

      // Fallback direct query on active churches if RPC is not deployed yet
      const query = supabase
        .from('churches')
        .select('id')
        .eq('slug', validation.normalized);
      const { data: rows } = excludeChurchId
        ? await query.neq('id', excludeChurchId).limit(1)
        : await query.limit(1);

      const taken = Boolean(rows && rows.length > 0);
      return {
        available: !taken,
        normalizedSlug: validation.normalized,
        reason: taken ? 'This URL slug is already in use by another church.' : undefined,
      };
    } catch {
      return {
        available: true,
        normalizedSlug: validation.normalized,
      };
    }
  }

  const conflict = getPreviewChurches().some(
    (c) =>
      c.slug.toLowerCase() === validation.normalized &&
      (!excludeChurchId || c.id !== excludeChurchId)
  );
  return {
    available: !conflict,
    normalizedSlug: validation.normalized,
    reason: conflict ? 'This URL slug is already in use by another church.' : undefined,
  };
}

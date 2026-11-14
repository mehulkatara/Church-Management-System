import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Helper to decode JWT payload safely
export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (err) {
    console.warn('Could not decode JWT payload:', err);
    return null;
  }
}

export interface ParsedOAuthData {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
  payload: Record<string, any>;
  supabaseUrl?: string;
}

// Parse token from string (either full URL, hash fragment, or raw token)
export function parseTokenString(input: string): ParsedOAuthData | null {
  if (!input || typeof input !== 'string') return null;
  try {
    let clean = input.trim();
    if (clean.includes('#')) {
      clean = clean.split('#')[1];
    } else if (clean.includes('?')) {
      clean = clean.split('?')[1];
    }
    const params = new URLSearchParams(clean);
    const accessToken = params.get('access_token') || (clean.startsWith('ey') ? clean : null);
    const refreshToken = params.get('refresh_token') || undefined;
    const expiresInStr = params.get('expires_in');
    const tokenType = params.get('token_type') || 'bearer';

    if (!accessToken) return null;

    const payload = decodeJwtPayload(accessToken);
    if (!payload) return null;

    let detectedUrl: string | undefined = undefined;
    if (payload.iss && typeof payload.iss === 'string') {
      detectedUrl = payload.iss.replace(/\/auth\/v1\/?$/, '');
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: expiresInStr ? parseInt(expiresInStr, 10) : 3600,
      tokenType,
      payload,
      supabaseUrl: detectedUrl,
    };
  } catch (err) {
    console.warn('Error parsing token string:', err);
    return null;
  }
}

// Parse OAuth hash fragment from URL
export function parseOAuthCallback(): ParsedOAuthData | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token=')) return null;

  const data = parseTokenString(hash);
  if (data?.supabaseUrl) {
    try {
      localStorage.setItem('VITE_SUPABASE_URL', data.supabaseUrl);
    } catch {
      // ignore
    }
  }
  return data;
}

export function hasOAuthCallback(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.hash.includes('access_token=');
}


// Read Vite client environment variables with local storage & OAuth auto-detection fallbacks
function getSupabaseUrl(): string {
  if (typeof window !== 'undefined') {
    const fromStorage = localStorage.getItem('VITE_SUPABASE_URL');
    if (fromStorage && fromStorage.startsWith('http')) return fromStorage;
  }
  const fromEnv = (
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_SUPABASE_URL
      : typeof process !== 'undefined' && process.env
      ? process.env.VITE_SUPABASE_URL
      : undefined
  ) as string | undefined;

  if (fromEnv && fromEnv.trim() !== '' && !fromEnv.includes('your-project-id')) {
    return fromEnv.trim();
  }
  // Default to user's real Supabase project
  return 'https://hjbepzqiitktxlqilhzo.supabase.co';
}

function getSupabaseAnonKey(): string {
  if (typeof window !== 'undefined') {
    const fromStorage =
      localStorage.getItem('VITE_SUPABASE_PUBLISHABLE_KEY') ||
      localStorage.getItem('VITE_SUPABASE_ANON_KEY');
    if (fromStorage && fromStorage.trim() !== '') return fromStorage.trim();
  }
  const fromEnv = (
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
      : typeof process !== 'undefined' && process.env
      ? process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
      : undefined
  ) as string | undefined;

  if (
    fromEnv &&
    fromEnv.trim() !== '' &&
    !fromEnv.includes('your-anon-publishable-key')
  ) {
    return fromEnv.trim();
  }
  return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';
}

export interface SupabaseConfigStatus {
  isConfigured: boolean;
  missingVariables: string[];
  supabaseUrl: string;
  hasAnonKey: boolean;
}

export function checkSupabaseConfig(): SupabaseConfigStatus {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();

  const isUrlValid = Boolean(
    url && url.trim() !== '' && !url.includes('your-project-id') && url.startsWith('http')
  );
  const isKeyValid = Boolean(
    key && key.trim() !== '' && !key.includes('your-anon-publishable-key')
  );

  const missing: string[] = [];
  if (!isUrlValid) missing.push('VITE_SUPABASE_URL');
  if (!isKeyValid) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');

  return {
    isConfigured: isUrlValid,
    missingVariables: missing,
    supabaseUrl: url,
    hasAnonKey: isKeyValid,
  };
}

export const supabaseConfig = checkSupabaseConfig();

const effectiveUrl = getSupabaseUrl();
const effectiveKey = getSupabaseAnonKey();

export const supabase: SupabaseClient = createClient(effectiveUrl, effectiveKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export function saveSupabaseCredentials(url: string, anonKey: string) {
  if (typeof window !== 'undefined') {
    if (url) localStorage.setItem('VITE_SUPABASE_URL', url.trim());
    if (anonKey) localStorage.setItem('VITE_SUPABASE_PUBLISHABLE_KEY', anonKey.trim());
    window.location.reload();
  }
}

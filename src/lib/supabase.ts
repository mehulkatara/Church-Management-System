import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Read Vite client environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export interface SupabaseConfigStatus {
  isConfigured: boolean;
  missingVariables: string[];
  supabaseUrl?: string;
  hasAnonKey: boolean;
}

export function checkSupabaseConfig(): SupabaseConfigStatus {
  const missing: string[] = [];
  const isUrlValid = Boolean(
    supabaseUrl &&
    supabaseUrl.trim() !== '' &&
    !supabaseUrl.includes('your-project-id') &&
    supabaseUrl.startsWith('http')
  );
  const isKeyValid = Boolean(
    supabaseAnonKey &&
    supabaseAnonKey.trim() !== '' &&
    !supabaseAnonKey.includes('your-anon-publishable-key')
  );

  if (!isUrlValid) missing.push('VITE_SUPABASE_URL');
  if (!isKeyValid) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');

  return {
    isConfigured: missing.length === 0,
    missingVariables: missing,
    supabaseUrl: isUrlValid ? supabaseUrl : undefined,
    hasAnonKey: isKeyValid,
  };
}

export const supabaseConfig = checkSupabaseConfig();

// Instantiate Supabase client (guaranteed typed instance; config status controls UI gating)
const effectiveUrl = supabaseConfig.isConfigured
  ? (supabaseUrl as string)
  : 'https://placeholder.supabase.co';
const effectiveKey = supabaseConfig.isConfigured
  ? (supabaseAnonKey as string)
  : 'placeholder-anon-key';

export const supabase: SupabaseClient = createClient(effectiveUrl, effectiveKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});


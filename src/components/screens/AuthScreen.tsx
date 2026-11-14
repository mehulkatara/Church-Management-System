import React, { useState } from 'react';
import { supabase, supabaseConfig } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import {
  Church as ChurchIcon,
  AlertCircle,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Sparkles,
  UserCheck,
  KeyRound,
  ExternalLink,
  Users,
} from 'lucide-react';

interface AuthScreenProps {
  onSuccess?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess }) => {
  const { signOut, loginAsPersona, authenticateWithToken } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfigGuide, setShowConfigGuide] = useState(false);
  const [copiedOrigin, setCopiedOrigin] = useState(false);
  const [pastedToken, setPastedToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(null);

  const handlePasteLogin = () => {
    setTokenError(null);
    if (!pastedToken.trim()) {
      setTokenError('Please paste the redirect URL or access token.');
      return;
    }
    const success = authenticateWithToken(pastedToken.trim());
    if (success) {
      if (onSuccess) onSuccess();
    } else {
      setTokenError('Invalid token or URL. Please ensure it contains access_token=...');
    }
  };

  // Real Supabase Google OAuth sign-in flow
  const handleGoogleSignIn = async () => {
    if (!supabase || !supabaseConfig.isConfigured) {
      setError(
        'Supabase is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment, or use the interactive testing personas below.'
      );
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const redirectUrl = window.location.origin;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (oauthError) throw oauthError;
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      console.error('Google OAuth error:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to initiate Google authentication. Please verify Google OAuth settings in your Supabase project.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Preview Persona Login Handler (dispatches synthetic demo sessions for instant testing)
  const handlePersonaLogin = (persona: 'applicant_new' | 'applicant_draft' | 'applicant_returned' | 'applicant_pending' | 'member' | 'accountant' | 'admin') => {
    loginAsPersona(persona);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mx-auto shadow-inner">
            <ChurchIcon className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Church Management System
          </h1>
          <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
            Multi-church donation tracking, verified member roster, and accountant approvals.
          </p>
        </div>

        {/* Notice of Google-Only Policy */}
        <div className="bg-sky-950/30 border border-sky-500/20 rounded-2xl p-3.5 text-xs text-sky-200 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-[11px] leading-relaxed">
            <span className="font-semibold text-white block">Google Authentication Required</span>
            <span>
              All church members, accountants, and administrators sign in securely using their
              verified Google account (including Google Workspace).
            </span>
          </div>
        </div>

        {/* Error Feedback */}
        {error && (
          <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 text-red-300 text-xs p-3.5 rounded-xl">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {/* Primary Action: Continue with Google */}
        <div className="space-y-3 pt-1">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full bg-white hover:bg-slate-100 text-slate-900 font-semibold py-3 px-4 rounded-2xl transition-all flex items-center justify-center gap-3 cursor-pointer shadow-xl hover:shadow-2xl border border-slate-200 active:scale-[0.99]"
          >
            {/* Google SVG Icon */}
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span className="text-sm font-medium">
              {isLoading ? 'Connecting to Google...' : 'Continue with Google'}
            </span>
          </button>

          <p className="text-[11px] text-center text-slate-500">
            Supports personal (@gmail.com) and Google Workspace church accounts.
          </p>
        </div>

        {/* Supabase URL Configuration Warning & 1-Click Copy */}
        <div className="bg-amber-950/40 border border-amber-500/40 rounded-2xl p-4 text-xs text-amber-200 space-y-2.5">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <strong className="text-white block font-semibold">
                Why does it redirect to localhost:3000?
              </strong>
              <p className="text-amber-200/90 leading-relaxed text-[11px]">
                In your Supabase project, the default <strong>Site URL</strong> is set to{' '}
                <code className="bg-slate-900 px-1 py-0.5 rounded text-amber-300 font-mono">http://localhost:3000</code>.
                To redirect back to this live app after Google sign-in, update your Supabase settings:
              </p>
            </div>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Your Current App URL:</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.origin);
                  setCopiedOrigin(true);
                  setTimeout(() => setCopiedOrigin(false), 2000);
                }}
                className="text-sky-400 hover:text-sky-300 font-medium px-2 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-[10px] cursor-pointer"
              >
                {copiedOrigin ? 'Copied!' : 'Copy App URL'}
              </button>
            </div>
            <div className="font-mono text-sky-300 text-[10px] truncate bg-slate-900 p-1.5 rounded border border-slate-800">
              {typeof window !== 'undefined' ? window.location.origin : 'https://...'}
            </div>
            <p className="text-slate-400 text-[10px] leading-relaxed">
              Open <strong>Supabase Dashboard &rarr; Authentication &rarr; URL Configuration</strong> and set{' '}
              <strong>Site URL</strong> to the App URL above, and add{' '}
              <code className="text-sky-300 font-mono">
                {typeof window !== 'undefined' ? `${window.location.origin}/**` : '...'}
              </code>{' '}
              to <strong>Redirect URLs</strong>.
            </p>
          </div>
        </div>

        {/* Manual Token Paste Recovery (If redirected to localhost:3000) */}
        <div className="p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 font-semibold flex items-center gap-1.5 text-[11px]">
              <KeyRound className="w-3.5 h-3.5 text-sky-400" />
              <span>Already redirected to localhost:3000?</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Instant Token Login</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Paste the redirected <code className="text-amber-300 font-mono">http://localhost:3000/#access_token=...</code> URL
            here to log in immediately without re-authenticating:
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={pastedToken}
              onChange={(e) => setPastedToken(e.target.value)}
              placeholder="Paste localhost URL or access_token here..."
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white placeholder-slate-500 font-mono focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={handlePasteLogin}
              className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs rounded-xl transition-colors cursor-pointer shrink-0"
            >
              Log In
            </button>
          </div>
          {tokenError && (
            <p className="text-[11px] text-red-400">{tokenError}</p>
          )}
        </div>


        {/* Security & Access Workflow Notice */}
        <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
          <span className="font-semibold text-slate-300 block">Strict Onboarding Separation:</span>
          <span>
            Google authentication verifies who you are. After sign-in, new applicants complete
            a profile form with Date of Birth, Phone, Gender, and Village / City Name for church
            Accountant verification before any church records are accessible.
          </span>
        </div>

        {/* Instant Testing Persona Switcher (For immediate sandbox verification) */}
        <div className="pt-2 border-t border-slate-800">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-2.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Interactive Verification Personas</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <button
              onClick={() => handlePersonaLogin('applicant_new')}
              className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-left transition-colors cursor-pointer"
            >
              <strong className="block text-sky-400 font-medium">New Applicant</strong>
              <span className="text-[10px] text-slate-500">Unlinked Google account</span>
            </button>

            <button
              onClick={() => handlePersonaLogin('applicant_draft')}
              className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-left transition-colors cursor-pointer"
            >
              <strong className="block text-amber-400 font-medium">Incomplete Draft</strong>
              <span className="text-[10px] text-slate-500">Resume saved profile</span>
            </button>

            <button
              onClick={() => handlePersonaLogin('applicant_returned')}
              className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-left transition-colors cursor-pointer"
            >
              <strong className="block text-orange-400 font-medium">Returned for Correction</strong>
              <span className="text-[10px] text-slate-500">Accountant feedback</span>
            </button>

            <button
              onClick={() => handlePersonaLogin('applicant_pending')}
              className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-left transition-colors cursor-pointer"
            >
              <strong className="block text-yellow-400 font-medium">Pending Review</strong>
              <span className="text-[10px] text-slate-500">Awaiting Accountant</span>
            </button>

            <button
              onClick={() => handlePersonaLogin('member')}
              className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <strong className="block text-indigo-400 font-medium">Verified Member</strong>
                  <span className="text-[10px] text-slate-500">Self profile &amp; statements</span>
                </div>
                <Users className="w-4 h-4 text-indigo-400" />
              </div>
            </button>

            <button
              onClick={() => handlePersonaLogin('accountant')}
              className="p-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <strong className="block text-emerald-400 font-medium">Church Accountant</strong>
                  <span className="text-[10px] text-slate-500">Side-by-side member review</span>
                </div>
                <UserCheck className="w-4 h-4 text-emerald-400" />
              </div>
            </button>
          </div>
        </div>

        {/* Collapsible Supabase Google OAuth Guide */}
        <div className="pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={() => setShowConfigGuide(!showConfigGuide)}
            className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-white transition-colors py-1 cursor-pointer"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <KeyRound className="w-3.5 h-3.5 text-sky-400" />
              <span>Supabase Google Provider Cutover Guide</span>
            </span>
            {showConfigGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showConfigGuide && (
            <div className="mt-3 p-4 bg-slate-950 rounded-2xl border border-slate-800 text-[11px] text-slate-400 space-y-3 leading-relaxed">
              <div>
                <strong className="text-white block font-semibold mb-1">
                  1. Enable Google Provider in Supabase
                </strong>
                <p>
                  In your Supabase Dashboard &rarr; <strong>Authentication</strong> &rarr;{' '}
                  <strong>Providers</strong> &rarr; <strong>Google</strong>:
                </p>
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-slate-400">
                  <li>Toggle Google to <strong>Enabled</strong>.</li>
                  <li>Paste your Google Cloud OAuth Client ID and Secret.</li>
                  <li>Add Supabase's redirect URI to your Google Cloud authorized redirect URIs.</li>
                </ul>
              </div>

              <div>
                <strong className="text-white block font-semibold mb-1">
                  2. Disable Unwanted Providers
                </strong>
                <p>
                  To complete cutover to Google-only authentication:
                </p>
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-slate-400">
                  <li>In <strong>Authentication</strong> &rarr; <strong>Providers</strong> &rarr; <strong>Email</strong>: toggle <em>Enable Email provider</em> to <strong>OFF</strong>.</li>
                  <li>Ensure Phone and third-party passwordless providers are disabled.</li>
                </ul>
              </div>

              <div>
                <strong className="text-white block font-semibold mb-1">
                  3. Permanent Account Identification
                </strong>
                <p>
                  The system uses Supabase's authenticated <code className="text-sky-300 font-mono">user.id</code> (UUID)
                  as the immutable identifier. The Google login email is never editable by applicants or church staff.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

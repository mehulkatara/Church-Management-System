import React, { useState } from 'react';
import { supabase, supabaseConfig } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { GOOGLE_PEOPLE_SCOPES } from '../../lib/google-people';
import { buildChurchPortalUrl } from '../../lib/domain-logic';
import { persistScopedChurchSlug } from '../../lib/church-slug';
import {
  Church as ChurchIcon,
  AlertCircle,
  ShieldCheck,
  MapPin,
  Phone,
  Mail,
  Lock,
} from 'lucide-react';

interface AuthScreenProps {
  onSuccess?: () => void;
  onNavigate?: (path: string) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess, onNavigate }) => {
  const {
    scopedChurch,
    clearScopedChurch,
  } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real Supabase Google OAuth sign-in flow
  const handleGoogleSignIn = async () => {
    if (!supabase || !supabaseConfig.isConfigured) {
      setError(
        'Authentication service is currently unavailable. Please contact your church administrator.'
      );
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const redirectUrl = scopedChurch
        ? buildChurchPortalUrl(window.location.origin, scopedChurch.slug)
        : window.location.origin;

      if (scopedChurch) {
        persistScopedChurchSlug(scopedChurch.slug, true);
      }

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          scopes: GOOGLE_PEOPLE_SCOPES.join(' '),
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
          : 'Unable to start Google sign-in right now. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        {/* Brand / Church-Specific Header */}
        {scopedChurch ? (
          <div className="space-y-4">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mx-auto shadow-inner">
                <ChurchIcon className="w-8 h-8" />
              </div>
              <div className="text-[11px] font-mono text-sky-300 flex items-center justify-center gap-1.5">
                <span>{scopedChurch.code}</span>
                <span aria-hidden="true" className="text-slate-600">
                  &middot;
                </span>
                <span>/{scopedChurch.slug}</span>
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight text-balance">
                {scopedChurch.name}
              </h1>
              <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                Dedicated congregation sign-in &amp; member onboarding portal.
              </p>
            </div>

            {/* Full Church Contact & Location Details */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-2xl p-4 space-y-2 text-xs">
              <div className="flex items-start gap-2.5 text-slate-300">
                <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span>{scopedChurch.address || 'Address not listed'}</span>
              </div>
              <div className="flex items-center gap-2.5 text-slate-300">
                <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span className="font-mono tabular-nums">
                  {scopedChurch.phone || 'Phone not listed'}
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-slate-300">
                <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span className="truncate">{scopedChurch.email || 'Email not listed'}</span>
              </div>
            </div>
          </div>
        ) : (
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
        )}

        {/* Notice of Google-Only Policy */}
        <div className="bg-sky-950/30 border border-sky-500/20 rounded-2xl p-3.5 text-xs text-sky-200 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5 text-[11px] leading-relaxed">
            <span className="font-semibold text-white block">Google Authentication Required</span>
            <span>
              {scopedChurch
                ? `Sign in with Google to access or request verified member onboarding at ${scopedChurch.name}.`
                : 'All church members, accountants, and administrators sign in securely using their verified Google account (including Google Workspace).'}
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

        {/* Security & Access Workflow Notice */}
        <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
            {scopedChurch && <Lock className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
            <span>
              {scopedChurch
                ? `Auto-Selected Onboarding: ${scopedChurch.name}`
                : 'Strict Onboarding Separation:'}
            </span>
          </span>
          <span>
            {scopedChurch
              ? `New members signing in through this link are automatically matched to ${scopedChurch.name} and verified by the church Accountant before accessing records.`
              : 'Google authentication verifies who you are. After sign-in, new applicants complete a profile form with Date of Birth, Phone, Gender, and Village / City Name for church Accountant verification before any church records are accessible.'}
          </span>
        </div>

        {/* Public App Home, Privacy Policy & Terms of Service Links */}
        <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-slate-400">
          {scopedChurch && (
            <>
              <button
                type="button"
                onClick={() => {
                  clearScopedChurch();
                  if (onNavigate) onNavigate('/');
                }}
                className="hover:text-sky-300 transition-colors cursor-pointer"
              >
                All Churches Sign-In
              </button>
              <span className="text-slate-700">&bull;</span>
            </>
          )}
          <a
            href="/home"
            onClick={(e) => {
              if (onNavigate) {
                e.preventDefault();
                onNavigate('/home');
              }
            }}
            className="hover:text-sky-300 transition-colors"
          >
            Application Home
          </a>
          <span className="text-slate-700">&bull;</span>
          <a
            href="/privacy-policy"
            onClick={(e) => {
              if (onNavigate) {
                e.preventDefault();
                onNavigate('/privacy-policy');
              }
            }}
            className="hover:text-sky-300 transition-colors"
          >
            Privacy Policy
          </a>
          <span className="text-slate-700">&bull;</span>
          <a
            href="/terms-of-service"
            onClick={(e) => {
              if (onNavigate) {
                e.preventDefault();
                onNavigate('/terms-of-service');
              }
            }}
            className="hover:text-sky-300 transition-colors"
          >
            Terms of Service
          </a>
        </div>
      </div>
    </div>
  );
};

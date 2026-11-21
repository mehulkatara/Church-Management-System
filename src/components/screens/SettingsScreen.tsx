import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Church } from '../../types/database';
import {
  buildAutoReceiptPrefix,
  buildChurchMemberPrefix,
  buildChurchPortalUrl,
  normalizeChurchSlugInput,
  validateChurchSlug,
} from '../../lib/domain-logic';
import {
  getPreviewChurches,
  savePreviewChurches,
  checkChurchSlugAvailability,
} from '../../lib/church-slug';
import {
  Settings,
  Receipt,
  MessageSquare,
  Link2,
  Copy,
  Check,
  Save,
  AlertCircle,
  CheckCircle2,
  Users,
} from 'lucide-react';

export const SettingsScreen: React.FC = () => {
  const {
    activeChurch,
    activeRole,
    isPlatformAdmin,
    refreshUserData,
    updateScopedChurchInState,
  } = useAuth();

  const [slugInput, setSlugInput] = useState(activeChurch?.slug || '');
  const [isSavingSlug, setIsSavingSlug] = useState(false);
  const [slugSuccess, setSlugSuccess] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    setSlugInput(activeChurch?.slug || '');
    setSlugSuccess(null);
    setSlugError(null);
  }, [activeChurch?.id, activeChurch?.slug]);

  const canEditSlug =
    isPlatformAdmin || activeRole === 'admin' || activeRole === 'accountant';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const livePortalUrl = buildChurchPortalUrl(
    origin,
    slugInput || activeChurch?.slug || 'church'
  );
  const sampleAutoPrefix = buildAutoReceiptPrefix(activeChurch?.code, new Date());
  const sampleMemberPrefix = buildChurchMemberPrefix(activeChurch?.code);

  const handleCopyUrl = async () => {
    if (!activeChurch) return;
    const savedUrl = buildChurchPortalUrl(origin, activeChurch.slug);
    try {
      await navigator.clipboard.writeText(savedUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleSaveSlug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChurch || !canEditSlug) return;

    setIsSavingSlug(true);
    setSlugSuccess(null);
    setSlugError(null);

    try {
      const validation = validateChurchSlug(slugInput);
      if (!validation.valid) {
        setSlugError(validation.error || 'Please enter a valid church URL slug.');
        setIsSavingSlug(false);
        return;
      }

      const availability = await checkChurchSlugAvailability(
        validation.normalized,
        activeChurch.id
      );
      if (!availability.available) {
        setSlugError(availability.reason || 'This URL slug is already used by another church.');
        setIsSavingSlug(false);
        return;
      }

      if (!supabase) {
        const updatedList = getPreviewChurches().map((c) =>
          c.id === activeChurch.id
            ? { ...c, slug: availability.normalizedSlug, updated_at: new Date().toISOString() }
            : c
        );
        savePreviewChurches(updatedList);
        const updatedTarget = updatedList.find((c) => c.id === activeChurch.id);
        if (updatedTarget) updateScopedChurchInState(updatedTarget);
      } else {
        const { data, error } = await supabase
          .from('churches')
          .update({ slug: availability.normalizedSlug })
          .eq('id', activeChurch.id)
          .select()
          .single();

        if (error) throw error;
        if (data) updateScopedChurchInState(data as Church);
        await refreshUserData();
      }

      setSlugInput(availability.normalizedSlug);
      setSlugSuccess(
        `Church URL updated to /${availability.normalizedSlug}`
      );
    } catch (err: unknown) {
      setSlugError(err instanceof Error ? err.message : 'Failed to update church URL slug.');
    } finally {
      setIsSavingSlug(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-sky-400" />
          <span>Church Administration Settings</span>
        </h1>
        <p className="text-xs text-slate-400">
          Operational configuration for{' '}
          <strong className="text-slate-200">{activeChurch?.name}</strong>
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-xs">
        {/* Dedicated Church Sign-In & Onboarding URL */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-white font-semibold">
              <Link2 className="w-4 h-4 text-sky-400" />
              <span>Dedicated Church Sign-In &amp; Onboarding URL</span>
            </div>
            {activeChurch && (
              <button
                type="button"
                onClick={handleCopyUrl}
                className="px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/20 text-sky-300 font-medium text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedLink ? 'Copied!' : 'Copy Church URL'}</span>
              </button>
            )}
          </div>

          <p className="text-slate-400 text-[11px] leading-relaxed">
            Share this link with members and new applicants. It displays{' '}
            <strong className="text-slate-200">{activeChurch?.name}</strong> details on the login
            screen, auto-selects this church during onboarding, and prevents members from switching
            to any other church.
          </p>

          {slugSuccess && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{slugSuccess}</span>
            </div>
          )}

          {slugError && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{slugError}</span>
            </div>
          )}

          <form onSubmit={handleSaveSlug} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex items-stretch bg-slate-950 border border-slate-700 rounded-xl overflow-hidden focus-within:border-sky-500">
                <span className="px-3 py-2 bg-slate-900 border-r border-slate-800 text-slate-400 font-mono flex items-center select-none">
                  /
                </span>
                <input
                  type="text"
                  value={slugInput}
                  onChange={(e) => {
                    setSlugInput(normalizeChurchSlugInput(e.target.value));
                    if (slugError) setSlugError(null);
                    if (slugSuccess) setSlugSuccess(null);
                  }}
                  readOnly={!canEditSlug}
                  disabled={!canEditSlug}
                  placeholder="grace-bethel"
                  className="flex-1 bg-transparent px-3 py-2 text-white font-mono focus:outline-none disabled:opacity-70"
                />
              </div>

              {canEditSlug && (
                <button
                  type="submit"
                  disabled={isSavingSlug}
                  className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-semibold px-4 py-2 rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingSlug ? 'Saving...' : 'Save URL Slug'}</span>
                </button>
              )}
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-sky-300 text-[11px] flex items-center justify-between gap-2">
              <span className="text-slate-400 shrink-0">Active Link Preview</span>
              <span className="truncate">{livePortalUrl}</span>
            </div>
          </form>
        </div>

        {/* Automatic Member ID Format (Read-only explanation) */}
        <div className="pt-4 border-t border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Users className="w-4 h-4 text-sky-400" />
            <span>Automatic Member ID Series</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Newly created or approved members automatically receive sequential IDs prefixed with
            your church code starting at 1. Existing historical member IDs remain unchanged, and your
            church code is locked once members exist.
          </p>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-sky-300 flex items-center justify-between gap-2">
            <span>New Member ID Sequence</span>
            <span className="font-semibold tabular-nums">
              {sampleMemberPrefix}1, {sampleMemberPrefix}2, ...
            </span>
          </div>
        </div>

        {/* Automatic Receipt Format (Read-only explanation) */}
        <div className="pt-4 border-t border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Receipt className="w-4 h-4 text-sky-400" />
            <span>Automatic Receipt Number Format</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Manual receipt prefix configuration is disabled. Receipt prefixes are automatically
            generated from your church code and the donation date&apos;s financial year (1 April
            &ndash; 31 March). Staff only enter the numeric receipt number.
          </p>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-sky-300 flex items-center justify-between gap-2">
            <span>Current Financial Year Format</span>
            <span className="font-semibold tabular-nums">{sampleAutoPrefix}142</span>
          </div>
        </div>

        {/* SMS Mode Setting */}
        <div className="pt-4 border-t border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-white font-semibold">
            <MessageSquare className="w-4 h-4 text-sky-400" />
            <span>SMS Delivery Method</span>
          </div>
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="text-white font-medium">Active Mode: Mode A (Send from my phone)</div>
            <div>
              Automated telecom provider dispatch (Mode B) requires server-side DLT credentials
              in Supabase Vault. Zero provider charges are incurred in Mode A.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

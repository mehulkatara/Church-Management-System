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
  DEFAULT_ANDROID_SMS_GATEWAY_URL,
  validateAndroidSmsGatewayUrl,
  formatPhoneForSmsGateway,
} from '../../lib/domain-logic';
import {
  getPreviewChurches,
  savePreviewChurches,
  checkChurchSlugAvailability,
} from '../../lib/church-slug';
import {
  getChurchSmsGatewayStatus,
  upsertChurchSmsGateway,
  sendTestSms,
} from '../../lib/sms-gateway';
import type { AndroidSmsGatewayStatus } from '../../types/database';
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
  Send,
  Loader2,
  Server,
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

  // Android SMS Gateway (Plan B) State
  const [gwStatus, setGwStatus] = useState<AndroidSmsGatewayStatus | null>(null);
  const [isLoadingGw, setIsLoadingGw] = useState(false);
  const [gwEnabled, setGwEnabled] = useState(true);
  const [gwUrl, setGwUrl] = useState(DEFAULT_ANDROID_SMS_GATEWAY_URL);
  const [gwUsername, setGwUsername] = useState('');
  const [gwPassword, setGwPassword] = useState('');
  const [gwDeviceId, setGwDeviceId] = useState('');
  const [gwSimNumber, setGwSimNumber] = useState<'' | '1' | '2'>('');
  const [isSavingGw, setIsSavingGw] = useState(false);
  const [gwSuccess, setGwSuccess] = useState<string | null>(null);
  const [gwError, setGwError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setSlugInput(activeChurch?.slug || '');
    setSlugSuccess(null);
    setSlugError(null);
  }, [activeChurch?.id, activeChurch?.slug]);

  const canEditChurchSettings =
    isPlatformAdmin || activeRole === 'admin' || activeRole === 'accountant';
  const canViewSmsStatus =
    canEditChurchSettings || activeRole === 'collector';

  useEffect(() => {
    if (!activeChurch?.id || !canViewSmsStatus) {
      setGwStatus(null);
      return;
    }

    let cancelled = false;
    const loadGateway = async () => {
      setIsLoadingGw(true);
      setGwSuccess(null);
      setGwError(null);
      setTestResult(null);
      setGwPassword('');
      try {
        const status = await getChurchSmsGatewayStatus(activeChurch.id);
        if (cancelled) return;
        setGwStatus(status);
        setGwEnabled(status.configured ? status.enabled : true);
        setGwUrl(status.api_url || DEFAULT_ANDROID_SMS_GATEWAY_URL);
        setGwUsername(status.username || '');
        setGwDeviceId(status.device_id || '');
        setGwSimNumber(
          status.sim_number === 1 ? '1' : status.sim_number === 2 ? '2' : ''
        );
      } finally {
        if (!cancelled) setIsLoadingGw(false);
      }
    };

    void loadGateway();
    return () => {
      cancelled = true;
    };
  }, [activeChurch?.id, canViewSmsStatus]);

  const canEditSlug = canEditChurchSettings;
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

  const handleSaveSmsGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChurch || !canEditChurchSettings) return;

    setGwSuccess(null);
    setGwError(null);
    setTestResult(null);

    const urlCheck = validateAndroidSmsGatewayUrl(gwUrl);
    if (!urlCheck.valid) {
      setGwError(urlCheck.error || 'Please enter a valid HTTPS Gateway URL.');
      return;
    }

    if (!gwUsername.trim()) {
      setGwError('Gateway username is required.');
      return;
    }

    if (!gwStatus?.has_password && !gwPassword.trim()) {
      setGwError('Gateway password is required for initial setup.');
      return;
    }

    setIsSavingGw(true);
    try {
      const updated = await upsertChurchSmsGateway({
        churchId: activeChurch.id,
        enabled: gwEnabled,
        apiUrl: urlCheck.normalized,
        username: gwUsername.trim(),
        password: gwPassword.trim(),
        deviceId: gwDeviceId.trim() || null,
        simNumber: gwSimNumber === '1' ? 1 : gwSimNumber === '2' ? 2 : null,
      });

      setGwStatus(updated);
      setGwUrl(updated.api_url);
      setGwPassword('');
      setGwSuccess(
        updated.enabled
          ? 'Android SMS Gateway saved and enabled for automatic donation receipts.'
          : 'Android SMS Gateway saved (automatic dispatch is currently paused).'
      );
    } catch (err: unknown) {
      setGwError(
        err instanceof Error ? err.message : 'Failed to save Android SMS Gateway configuration.'
      );
    } finally {
      setIsSavingGw(false);
    }
  };

  const handleSendTestSms = async () => {
    if (!activeChurch || !canEditChurchSettings) return;

    setTestResult(null);
    const e164 = formatPhoneForSmsGateway(testPhone);
    if (!e164) {
      setTestResult({
        ok: false,
        text: 'Enter a valid 10-digit Indian mobile number (or E.164 number with +) to test.',
      });
      return;
    }

    setIsSendingTest(true);
    try {
      const res = await sendTestSms({
        churchId: activeChurch.id,
        phone: e164,
      });
      setTestResult({ ok: res.ok, text: res.message });
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to send test SMS.',
      });
    } finally {
      setIsSendingTest(false);
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

        {/* Plan B: Android SMS Gateway Configuration */}
        <div className="pt-4 border-t border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-white font-semibold">
              <MessageSquare className="w-4 h-4 text-sky-400" />
              <span>SMS Delivery (Plan B &middot; Android SMS Gateway)</span>
            </div>
            <span
              className={`text-[11px] font-mono font-medium ${
                gwStatus?.configured && gwStatus.enabled
                  ? 'text-emerald-400'
                  : gwStatus?.configured
                  ? 'text-amber-300'
                  : 'text-slate-400'
              }`}
            >
              {isLoadingGw
                ? 'Checking gateway...'
                : gwStatus?.configured && gwStatus.enabled
                ? 'Active · Cloud Server'
                : gwStatus?.configured
                ? 'Configured · Paused'
                : 'Not Configured'}
            </span>
          </div>

          <p className="text-slate-400 text-[11px] leading-relaxed">
            Automatically dispatches receipt confirmations through your Android phone running{' '}
            <strong className="text-slate-200">capcom6 Android SMS Gateway</strong> in Cloud Server
            mode (<span className="font-mono text-sky-300">api.sms-gate.app</span>). Credentials stay
            isolated on the server and are never readable by members or browser scripts.
          </p>

          {!canViewSmsStatus ? (
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400">
              Automatic receipt SMS is managed by your church Admin or Accountant.
            </div>
          ) : !canEditChurchSettings ? (
            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Gateway Endpoint</span>
                <span className="font-mono text-sky-300 truncate max-w-[260px]">
                  {gwStatus?.api_url || DEFAULT_ANDROID_SMS_GATEWAY_URL}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Auto-Dispatch Status</span>
                <span className="font-medium text-white">
                  {gwStatus?.configured && gwStatus.enabled
                    ? 'Enabled on donation save'
                    : gwStatus?.configured
                    ? 'Paused by Admin/Accountant'
                    : 'Not configured yet'}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {gwSuccess && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{gwSuccess}</span>
                </div>
              )}

              {gwError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-300 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{gwError}</span>
                </div>
              )}

              <form onSubmit={handleSaveSmsGateway} className="space-y-3.5 bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <label className="flex items-center justify-between gap-3 cursor-pointer pb-2 border-b border-slate-800/80">
                  <div>
                    <span className="block text-xs font-semibold text-white">
                      Enable Automatic SMS on Donation Save
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Sends receipt SMS right after saving; failures never undo saved donations.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={gwEnabled}
                    onChange={(e) => setGwEnabled(e.target.checked)}
                    className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                  />
                </label>

                <div>
                  <label htmlFor="sms-gw-url" className="block text-[11px] font-medium text-slate-300 mb-1">
                    Cloud Server API URL <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <Server className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      id="sms-gw-url"
                      type="url"
                      value={gwUrl}
                      onChange={(e) => setGwUrl(e.target.value)}
                      required
                      placeholder={DEFAULT_ANDROID_SMS_GATEWAY_URL}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="sms-gw-user" className="block text-[11px] font-medium text-slate-300 mb-1">
                      Gateway Username <span className="text-red-400">*</span>
                    </label>
                    <input
                      id="sms-gw-user"
                      type="text"
                      autoComplete="off"
                      value={gwUsername}
                      onChange={(e) => setGwUsername(e.target.value)}
                      required
                      placeholder="Username from Android app"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="sms-gw-pass" className="block text-[11px] font-medium text-slate-300 mb-1">
                      Gateway Password{' '}
                      {gwStatus?.has_password ? (
                        <span className="text-slate-400 font-normal">(Saved)</span>
                      ) : (
                        <span className="text-red-400">*</span>
                      )}
                    </label>
                    <input
                      id="sms-gw-pass"
                      type="password"
                      autoComplete="new-password"
                      value={gwPassword}
                      onChange={(e) => setGwPassword(e.target.value)}
                      required={!gwStatus?.has_password}
                      placeholder={
                        gwStatus?.has_password
                          ? 'Leave blank to keep saved password'
                          : 'Password from Android app'
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="sms-gw-sim" className="block text-[11px] font-medium text-slate-300 mb-1">
                      SIM Slot <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <select
                      id="sms-gw-sim"
                      value={gwSimNumber}
                      onChange={(e) => setGwSimNumber(e.target.value as '' | '1' | '2')}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                    >
                      <option value="">Automatic (Phone Default SIM)</option>
                      <option value="1">SIM 1</option>
                      <option value="2">SIM 2</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="sms-gw-device" className="block text-[11px] font-medium text-slate-300 mb-1">
                      Device ID <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <input
                      id="sms-gw-device"
                      type="text"
                      value={gwDeviceId}
                      onChange={(e) => setGwDeviceId(e.target.value)}
                      placeholder="Only needed for multi-device accounts"
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] text-slate-500 font-mono">
                    POST /messages &middot; HTTP Basic Auth
                  </span>
                  <button
                    type="submit"
                    disabled={isSavingGw}
                    className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-semibold px-4 py-2 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isSavingGw ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>{isSavingGw ? 'Saving...' : 'Save SMS Gateway'}</span>
                  </button>
                </div>
              </form>

              {gwStatus?.configured && (
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Send Test SMS</span>
                    <span className="text-[11px] text-slate-400">Uses saved gateway settings</span>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="tel"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      placeholder="10-digit mobile (e.g. 9840012345)"
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                    <button
                      type="button"
                      onClick={handleSendTestSms}
                      disabled={isSendingTest}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold px-4 py-2 rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {isSendingTest ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>{isSendingTest ? 'Sending...' : 'Send Test SMS'}</span>
                    </button>
                  </div>

                  {testResult && (
                    <div
                      className={`p-2.5 rounded-xl border text-[11px] flex items-center gap-2 ${
                        testResult.ok
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                          : 'bg-red-500/10 border-red-500/20 text-red-300'
                      }`}
                    >
                      {testResult.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      <span>{testResult.text}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

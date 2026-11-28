import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type {
  Member,
  BroadcastCampaign,
  BroadcastAudienceMode,
  AndroidSmsGatewayStatus,
} from '../../types/database';
import {
  BROADCAST_PLACEHOLDERS,
  BROADCAST_STARTER_TEMPLATES,
  renderBroadcastMessage,
  estimateSmsSegments,
  filterBroadcastMembers,
  validateBroadcastInput,
  buildVillageSuggestions,
  formatPhoneForSmsGateway,
  checkRolePermission,
} from '../../lib/domain-logic';
import {
  getChurchSmsGatewayStatus,
  sendMemberBroadcastSms,
} from '../../lib/sms-gateway';
import type { ScreenId } from '../common/Sidebar';
import {
  Megaphone,
  Send,
  Users,
  MapPin,
  CheckSquare,
  Square,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Phone,
  Smartphone,
  History,
  X,
} from 'lucide-react';

interface BroadcastScreenProps {
  onNavigate?: (screen: ScreenId) => void;
}

const PREVIEW_SAMPLE_MEMBERS: Member[] = [
  {
    id: 'mem-preview-1',
    church_id: 'c1111111-1111-1111-1111-111111111111',
    member_number: 'BETHEL-1',
    full_name: 'Samuel Rajan',
    contact_phone: '9840123456',
    village_name: 'Tambaram',
    gender: 'male',
    date_of_birth: '1988-05-14',
    joining_date: '2024-01-10',
    membership_status: 'active',
    created_at: '2024-01-10T00:00:00Z',
    updated_at: '2024-01-10T00:00:00Z',
    created_by: null,
    updated_by: null,
  },
  {
    id: 'mem-preview-2',
    church_id: 'c1111111-1111-1111-1111-111111111111',
    member_number: 'BETHEL-2',
    full_name: 'Mary Magdalene',
    contact_phone: '9884111222',
    village_name: 'Kallakurichi',
    gender: 'female',
    date_of_birth: '1993-08-21',
    joining_date: '2024-03-18',
    membership_status: 'active',
    created_at: '2024-03-18T00:00:00Z',
    updated_at: '2024-03-18T00:00:00Z',
    created_by: null,
    updated_by: null,
  },
  {
    id: 'mem-preview-3',
    church_id: 'c1111111-1111-1111-1111-111111111111',
    member_number: 'BETHEL-3',
    full_name: 'Stephen Joseph',
    contact_phone: '9840999999',
    village_name: 'Guindy',
    gender: 'male',
    date_of_birth: '1991-11-04',
    joining_date: '2024-05-02',
    membership_status: 'active',
    created_at: '2024-05-02T00:00:00Z',
    updated_at: '2024-05-02T00:00:00Z',
    created_by: null,
    updated_by: null,
  },
  {
    id: 'mem-preview-4',
    church_id: 'c1111111-1111-1111-1111-111111111111',
    member_number: 'BETHEL-4',
    full_name: 'Elizabeth Grace',
    contact_phone: null,
    village_name: 'Tambaram',
    gender: 'female',
    date_of_birth: '1979-02-28',
    joining_date: '2024-06-15',
    membership_status: 'active',
    created_at: '2024-06-15T00:00:00Z',
    updated_at: '2024-06-15T00:00:00Z',
    created_by: null,
    updated_by: null,
  },
];

export const BroadcastScreen: React.FC<BroadcastScreenProps> = ({ onNavigate }) => {
  const { activeChurch, activeRole, isPlatformAdmin, user } = useAuth();

  const effectiveRole = isPlatformAdmin ? 'platform_admin' : activeRole;
  const canBroadcast = checkRolePermission(effectiveRole, 'send_broadcast_sms').allowed;

  const [members, setMembers] = useState<Member[]>([]);
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>([]);
  const [gatewayStatus, setGatewayStatus] = useState<AndroidSmsGatewayStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [audienceMode, setAudienceMode] = useState<BroadcastAudienceMode>('all_active');
  const [villageFilter, setVillageFilter] = useState<string>('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState<string>('');

  const [title, setTitle] = useState<string>(BROADCAST_STARTER_TEMPLATES[0].title);
  const [messageTemplate, setMessageTemplate] = useState<string>(
    BROADCAST_STARTER_TEMPLATES[0].body
  );
  const [previewIndex, setPreviewIndex] = useState<number>(0);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isPreviewMode =
    !supabase ||
    (typeof window !== 'undefined' && Boolean(window.sessionStorage.getItem('cms_preview_persona')));

  const loadBroadcastData = useCallback(async () => {
    if (!activeChurch) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      if (isPreviewMode || !supabase) {
        setMembers(
          PREVIEW_SAMPLE_MEMBERS.map((m) => ({ ...m, church_id: activeChurch.id }))
        );
        const storageKey = `cms_preview_broadcasts_${activeChurch.id}`;
        try {
          const saved = window.localStorage.getItem(storageKey);
          setCampaigns(saved ? (JSON.parse(saved) as BroadcastCampaign[]) : []);
        } catch {
          setCampaigns([]);
        }
        setGatewayStatus({
          configured: true,
          enabled: true,
          provider: 'android_sms_gateway',
          api_url: 'https://api.sms-gate.app/3rdparty/v1',
          username: 'preview-gateway',
          has_password: true,
          device_id: null,
          sim_number: 1,
          updated_at: new Date().toISOString(),
        });
        setIsLoading(false);
        return;
      }

      const [membersRes, campaignsRes, gw] = await Promise.all([
        supabase
          .from('members')
          .select('*')
          .eq('church_id', activeChurch.id)
          .eq('membership_status', 'active')
          .order('full_name'),
        supabase
          .from('broadcast_campaigns')
          .select('*')
          .eq('church_id', activeChurch.id)
          .order('created_at', { ascending: false })
          .limit(25),
        getChurchSmsGatewayStatus(activeChurch.id),
      ]);

      if (membersRes.error) throw membersRes.error;
      setMembers((membersRes.data || []) as Member[]);

      if (!campaignsRes.error && campaignsRes.data) {
        setCampaigns(campaignsRes.data as BroadcastCampaign[]);
      } else {
        setCampaigns([]);
      }
      setGatewayStatus(gw);
    } catch (err) {
      console.error('Error loading broadcast workspace:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeChurch, isPreviewMode]);

  useEffect(() => {
    void loadBroadcastData();
  }, [loadBroadcastData]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.membership_status === 'active'),
    [members]
  );

  const villageOptions = useMemo(
    () => buildVillageSuggestions(activeMembers.map((m) => m.village_name)),
    [activeMembers]
  );

  useEffect(() => {
    if (audienceMode === 'village' && !villageFilter && villageOptions.length > 0) {
      setVillageFilter(villageOptions[0]);
    }
  }, [audienceMode, villageFilter, villageOptions]);

  const filteredSelectorMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return activeMembers;
    return activeMembers.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        m.member_number.toLowerCase().includes(q) ||
        (m.village_name || '').toLowerCase().includes(q) ||
        (m.contact_phone || '').toLowerCase().includes(q)
    );
  }, [activeMembers, memberSearch]);

  const { targetedMembers, readyMembers, missingPhoneMembers } = useMemo(
    () =>
      filterBroadcastMembers({
        members: activeMembers,
        mode: audienceMode,
        villageFilter,
        selectedMemberIds,
      }),
    [activeMembers, audienceMode, villageFilter, selectedMemberIds]
  );

  // Clamp preview index safely when filtered recipients change
  const safePreviewIndex =
    readyMembers.length > 0 ? Math.min(previewIndex, readyMembers.length - 1) : 0;
  const previewRecipient: Member | null = readyMembers[safePreviewIndex] || targetedMembers[0] || null;

  const renderedPreviewText = useMemo(() => {
    return renderBroadcastMessage(messageTemplate, {
      fullName: previewRecipient?.full_name || 'Samuel Rajan',
      memberNumber: previewRecipient?.member_number || 'MEMBER-1',
      villageName: previewRecipient?.village_name || 'Tambaram',
      churchName: activeChurch?.name || 'Church',
    });
  }, [messageTemplate, previewRecipient, activeChurch]);

  const smsStats = useMemo(
    () => estimateSmsSegments(renderedPreviewText),
    [renderedPreviewText]
  );

  const insertPlaceholderAtCursor = (token: string) => {
    const el = textareaRef.current;
    if (!el) {
      setMessageTemplate((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${token}`);
      return;
    }

    const start = el.selectionStart ?? messageTemplate.length;
    const end = el.selectionEnd ?? messageTemplate.length;
    const before = messageTemplate.slice(0, start);
    const after = messageTemplate.slice(end);
    const nextValue = `${before}${token}${after}`;
    setMessageTemplate(nextValue);
    setFormError(null);

    window.requestAnimationFrame(() => {
      el.focus();
      const nextCursor = start + token.length;
      el.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const toggleMemberSelection = (memberId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
    setFormError(null);
  };

  const selectAllReadyMembers = () => {
    const ids = filteredSelectorMembers
      .filter((m) => Boolean(formatPhoneForSmsGateway(m.contact_phone)))
      .map((m) => m.id);
    setSelectedMemberIds((prev) => Array.from(new Set([...prev, ...ids])));
    setFormError(null);
  };

  const clearMemberSelection = () => {
    setSelectedMemberIds([]);
  };

  const handleOpenConfirmModal = () => {
    setFormError(null);
    setSendFeedback(null);

    const validation = validateBroadcastInput({
      title,
      messageTemplate,
      readyRecipientCount: readyMembers.length,
    });

    if (!validation.valid) {
      setFormError(validation.error || 'Please check your message and recipients.');
      return;
    }

    if (!isPreviewMode && (!gatewayStatus?.configured || !gatewayStatus.enabled)) {
      setFormError(
        'Android SMS Gateway is not enabled for this church. Configure or enable it under Church Settings -> SMS Delivery first.'
      );
      return;
    }

    setShowConfirmModal(true);
  };

  const handleConfirmSend = async () => {
    if (!activeChurch) return;

    const validation = validateBroadcastInput({
      title,
      messageTemplate,
      readyRecipientCount: readyMembers.length,
    });
    if (!validation.valid) {
      setFormError(validation.error || 'Invalid broadcast configuration.');
      setShowConfirmModal(false);
      return;
    }

    setIsSending(true);
    setFormError(null);
    setSendFeedback(null);

    try {
      if (isPreviewMode || !supabase) {
        const simulatedCampaign: BroadcastCampaign = {
          id: `bc-preview-${Date.now()}`,
          church_id: activeChurch.id,
          title: validation.normalizedTitle,
          message_template: validation.normalizedTemplate,
          audience_filter: {
            mode: audienceMode,
            village: audienceMode === 'village' ? villageFilter : null,
            selected_count: readyMembers.length,
          },
          total_targeted: targetedMembers.length,
          sent_count: readyMembers.length,
          failed_count: 0,
          skipped_no_phone_count: missingPhoneMembers.length,
          created_by: user?.id || 'preview-actor',
          created_at: new Date().toISOString(),
        };

        const storageKey = `cms_preview_broadcasts_${activeChurch.id}`;
        const nextList = [simulatedCampaign, ...campaigns].slice(0, 25);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(nextList));
        } catch {
          // ignore
        }
        setCampaigns(nextList);
        setShowConfirmModal(false);
        setSendFeedback({
          ok: true,
          text: `Preview broadcast logged for ${readyMembers.length} member phone(s). Connect Supabase to dispatch live SMS via Android SMS Gateway.`,
        });
        return;
      }

      const res = await sendMemberBroadcastSms({
        churchId: activeChurch.id,
        title: validation.normalizedTitle,
        messageTemplate: validation.normalizedTemplate,
        audienceMode,
        villageFilter: audienceMode === 'village' ? villageFilter : null,
        memberIds: audienceMode === 'selected' ? readyMembers.map((m) => m.id) : [],
      });

      setShowConfirmModal(false);
      setSendFeedback({
        ok: res.ok,
        text: res.message,
      });
      await loadBroadcastData();
    } catch (err: unknown) {
      setShowConfirmModal(false);
      setSendFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to dispatch member broadcast.',
      });
    } finally {
      setIsSending(false);
    }
  };

  if (!canBroadcast) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-2">
        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
        <h2 className="text-base font-semibold text-white">Access Restricted</h2>
        <p className="text-xs text-slate-400">
          Only Accountants, Church Admins, and Platform Admins can compose and broadcast member messages.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-sky-400" />
            <span>Member SMS Broadcast</span>
          </h1>
          <p className="text-xs text-slate-400">
            Church: <strong className="text-slate-200">{activeChurch?.name}</strong> &middot; Send
            personalized messages to active member mobile numbers
          </p>
        </div>

        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('notifications')}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-200 flex items-center gap-1.5 transition-colors self-start sm:self-auto cursor-pointer whitespace-nowrap shrink-0"
          >
            <Smartphone className="w-3.5 h-3.5 text-sky-400" />
            <span>View SMS Delivery Queue</span>
          </button>
        )}
      </div>

      {/* Gateway Readiness Banner */}
      {!isLoading && (!gatewayStatus?.configured || !gatewayStatus.enabled) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-xs text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold text-amber-300 block">
                {gatewayStatus?.configured
                  ? 'Android SMS Gateway is Paused'
                  : 'Android SMS Gateway Not Configured'}
              </strong>
              <span className="text-amber-200/80">
                Enable and save your Cloud Server credentials in Church Settings &rarr; SMS Delivery before sending live broadcasts.
              </span>
            </div>
          </div>
          {onNavigate && (effectiveRole === 'admin' || effectiveRole === 'platform_admin') && (
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-semibold text-xs cursor-pointer whitespace-nowrap shrink-0"
            >
              Open Settings
            </button>
          )}
        </div>
      )}

      {/* Result Feedback */}
      {sendFeedback && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-start gap-2.5 ${
            sendFeedback.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          {sendFeedback.ok ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          )}
          <span>{sendFeedback.text}</span>
        </div>
      )}

      {formError && (
        <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {/* Main 2-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Audience + Composer */}
        <div className="lg:col-span-7 space-y-6">
          {/* 1. Audience Selection Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-400" />
                <span>1. Select Recipients (Active Members)</span>
              </h2>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                {activeMembers.length} active total
              </span>
            </div>

            {/* Audience Mode Tabs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setAudienceMode('all_active');
                  setPreviewIndex(0);
                }}
                className={`px-3 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  audienceMode === 'all_active'
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-200 font-semibold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-sky-400" />
                  <span>All Active Members</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAudienceMode('village');
                  setPreviewIndex(0);
                }}
                className={`px-3 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  audienceMode === 'village'
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-200 font-semibold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-sky-400" />
                  <span>By Village / City</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAudienceMode('selected');
                  setPreviewIndex(0);
                }}
                className={`px-3 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  audienceMode === 'selected'
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-200 font-semibold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5 text-sky-400" />
                  <span>Custom Selection</span>
                </div>
              </button>
            </div>

            {/* Mode-Specific Controls */}
            {audienceMode === 'village' && (
              <div className="space-y-1.5">
                <label className="block text-xs text-slate-400 font-medium">
                  Choose Village / City
                </label>
                {villageOptions.length === 0 ? (
                  <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                    No village names recorded on active members yet.
                  </p>
                ) : (
                  <select
                    value={villageFilter}
                    onChange={(e) => {
                      setVillageFilter(e.target.value);
                      setPreviewIndex(0);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                  >
                    {villageOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {audienceMode === 'selected' && (
              <div className="space-y-2.5">
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search by name, Member ID, village, or phone..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={selectAllReadyMembers}
                      className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 text-[11px] font-medium border border-slate-700 cursor-pointer"
                    >
                      Select Ready
                    </button>
                    <button
                      type="button"
                      onClick={clearMemberSelection}
                      className="px-2.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 text-[11px] font-medium border border-slate-800 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="max-h-52 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950 divide-y divide-slate-800/70">
                  {filteredSelectorMembers.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500">
                      No matching active members found.
                    </div>
                  ) : (
                    filteredSelectorMembers.map((m) => {
                      const isChecked = selectedMemberIds.includes(m.id);
                      const validE164 = formatPhoneForSmsGateway(m.contact_phone);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleMemberSelection(m.id)}
                          className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                            isChecked ? 'bg-sky-500/10' : 'hover:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isChecked ? (
                              <CheckSquare className="w-4 h-4 text-sky-400 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-600 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="font-medium text-white truncate">
                                {m.full_name}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono truncate">
                                {m.member_number}
                                {m.village_name ? ` · ${m.village_name}` : ''}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-mono shrink-0 ${
                              validE164 ? 'text-emerald-400' : 'text-amber-400'
                            }`}
                          >
                            {validE164 || 'No valid phone'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            {/* Audience Readiness Summary */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5">
                <div className="text-[10px] text-slate-400">Matched Active</div>
                <div className="text-sm font-bold font-mono tabular-nums text-white mt-0.5">
                  {targetedMembers.length}
                </div>
              </div>
              <div className="bg-slate-950 border border-emerald-500/20 rounded-xl p-2.5">
                <div className="text-[10px] text-emerald-400">Ready with Phone</div>
                <div className="text-sm font-bold font-mono tabular-nums text-emerald-300 mt-0.5">
                  {readyMembers.length}
                </div>
              </div>
              <div className="bg-slate-950 border border-amber-500/20 rounded-xl p-2.5">
                <div className="text-[10px] text-amber-400">Skipped (No Phone)</div>
                <div className="text-sm font-bold font-mono tabular-nums text-amber-300 mt-0.5">
                  {missingPhoneMembers.length}
                </div>
              </div>
            </div>
          </div>

          {/* 2. Personalized Message Composer Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                <span>2. Compose Personalized Message</span>
              </h2>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                {smsStats.charCount} chars &middot; {smsStats.segments} SMS{' '}
                {smsStats.isUnicode ? '(Unicode)' : '(Standard)'}
              </span>
            </div>

            {/* Starter Templates */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-slate-400 font-medium block">
                Quick Templates (click to load, then customize):
              </span>
              <div className="flex flex-wrap gap-2">
                {BROADCAST_STARTER_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      setTitle(tpl.title);
                      setMessageTemplate(tpl.body);
                      setFormError(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-[11px] text-slate-300 hover:text-white transition-colors cursor-pointer"
                  >
                    {tpl.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setTitle('');
                    setMessageTemplate('');
                    setFormError(null);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  Blank Message
                </button>
              </div>
            </div>

            {/* Broadcast Title */}
            <div>
              <label className="block text-xs text-slate-300 font-medium mb-1">
                Broadcast Title (for audit &amp; history)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="e.g. Sunday Service Reminder"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Clickable Placeholder Toolbar */}
            <div className="space-y-1.5">
              <span className="text-[11px] text-slate-400 font-medium block">
                Insert User-Specific Placeholders at Cursor:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {BROADCAST_PLACEHOLDERS.map((ph) => (
                  <button
                    key={ph.token}
                    type="button"
                    title={`${ph.description} (e.g. ${ph.sampleValue})`}
                    onClick={() => insertPlaceholderAtCursor(ph.token)}
                    className="px-2.5 py-1 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-[11px] font-mono text-sky-300 transition-colors cursor-pointer"
                  >
                    + {ph.token}
                  </button>
                ))}
              </div>
            </div>

            {/* Message Textarea */}
            <div>
              <label className="block text-xs text-slate-300 font-medium mb-1">
                Message Template <span className="text-red-400">*</span>
              </label>
              <textarea
                ref={textareaRef}
                rows={5}
                value={messageTemplate}
                onChange={(e) => {
                  setMessageTemplate(e.target.value);
                  setFormError(null);
                }}
                maxLength={1600}
                placeholder="Dear {{first_name}}, greetings from {{church_name}}..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 leading-relaxed"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Placeholders are replaced with each active member's own Name, Member ID, Village / City, and Church Name before sending.
              </p>
            </div>
          </div>
        </div>

        {/* Right: Live Per-Member Preview & Dispatch */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <Phone className="w-4 h-4 text-emerald-400" />
                <span>Live Per-Member Preview</span>
              </h2>
              {readyMembers.length > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Previous recipient preview"
                    onClick={() =>
                      setPreviewIndex((prev) =>
                        prev <= 0 ? readyMembers.length - 1 : prev - 1
                      )
                    }
                    className="p-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] font-mono tabular-nums text-slate-400 px-1.5">
                    {safePreviewIndex + 1} / {readyMembers.length}
                  </span>
                  <button
                    type="button"
                    aria-label="Next recipient preview"
                    onClick={() =>
                      setPreviewIndex((prev) =>
                        prev >= readyMembers.length - 1 ? 0 : prev + 1
                      )
                    }
                    className="p-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {readyMembers.length > 0 ? (
              <div className="space-y-3">
                <select
                  value={previewRecipient?.id || ''}
                  onChange={(e) => {
                    const idx = readyMembers.findIndex((m) => m.id === e.target.value);
                    if (idx >= 0) setPreviewIndex(idx);
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
                >
                  {readyMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name} ({m.member_number}) &middot;{' '}
                      {formatPhoneForSmsGateway(m.contact_phone) || m.contact_phone}
                    </option>
                  ))}
                </select>

                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800/80 pb-2">
                    <span className="font-semibold text-slate-200 truncate">
                      To: {previewRecipient?.full_name}
                    </span>
                    <span className="font-mono text-emerald-400 shrink-0">
                      {formatPhoneForSmsGateway(previewRecipient?.contact_phone)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-100 whitespace-pre-wrap leading-relaxed min-h-[5rem]">
                    {renderedPreviewText || (
                      <span className="text-slate-500 italic">
                        Message preview will appear here...
                      </span>
                    )}
                  </p>
                  <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span>
                      ID: {previewRecipient?.member_number} &middot;{' '}
                      {previewRecipient?.village_name || 'No village'}
                    </span>
                    <span>
                      {smsStats.charCount} chars &middot; {smsStats.segments} SMS
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 text-center text-xs text-slate-500">
                No active members with a valid mobile number match the current recipient filter.
              </div>
            )}

            <button
              type="button"
              onClick={handleOpenConfirmModal}
              disabled={isSending || readyMembers.length === 0 || !messageTemplate.trim()}
              className="w-full py-3 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
            >
              {isSending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending Broadcast...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>
                    Send Broadcast to {readyMembers.length} Member
                    {readyMembers.length === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Broadcast History */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-xs font-semibold text-white tracking-tight flex items-center gap-2">
            <History className="w-4 h-4 text-sky-400" />
            <span>Recent Broadcast Campaigns</span>
          </span>
          <span className="text-[11px] font-mono tabular-nums text-slate-400">
            {campaigns.length} campaign{campaigns.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-400 font-medium">
                <th className="py-2.5 px-4">Title &amp; Message Template</th>
                <th className="py-2.5 px-4">Audience</th>
                <th className="py-2.5 px-4 text-center">Sent</th>
                <th className="py-2.5 px-4 text-center">Failed</th>
                <th className="py-2.5 px-4 text-center">Skipped</th>
                <th className="py-2.5 px-4 text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading broadcast history...
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No member broadcasts sent yet.
                  </td>
                </tr>
              ) : (
                campaigns.map((camp) => (
                  <tr key={camp.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 max-w-md">
                      <div className="font-semibold text-white">{camp.title}</div>
                      <div
                        className="text-[11px] text-slate-400 truncate mt-0.5"
                        title={camp.message_template}
                      >
                        {camp.message_template}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-slate-300 whitespace-nowrap">
                      {camp.audience_filter?.mode === 'village'
                        ? `Village: ${camp.audience_filter.village || '-'}`
                        : camp.audience_filter?.mode === 'selected'
                        ? 'Custom Selection'
                        : 'All Active'}
                      <div className="text-[10px] font-mono text-slate-500">
                        {camp.total_targeted} targeted
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono tabular-nums text-emerald-400 font-semibold">
                      {camp.sent_count}
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono tabular-nums text-red-400">
                      {camp.failed_count}
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono tabular-nums text-amber-300">
                      {camp.skipped_no_phone_count}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-[11px] text-slate-400 whitespace-nowrap">
                      {new Date(camp.created_at).toLocaleString('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white">Confirm Member SMS Broadcast</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Review recipient count and sample personalized SMS before dispatching.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !isSending && setShowConfirmModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Church:</span>
                <span className="text-white font-semibold">{activeChurch?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Recipients with valid phone:</span>
                <span className="text-emerald-400 font-mono font-semibold">
                  {readyMembers.length} active member{readyMembers.length === 1 ? '' : 's'}
                </span>
              </div>
              {missingPhoneMembers.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Skipped (no valid phone):</span>
                  <span className="text-amber-300 font-mono">{missingPhoneMembers.length}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-400">Estimated segments / member:</span>
                <span className="text-slate-200 font-mono">
                  {smsStats.segments} SMS ({smsStats.charCount} chars)
                </span>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1">
              <div className="text-[10px] font-mono text-slate-400">
                Sample for {previewRecipient?.full_name}:
              </div>
              <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                {renderedPreviewText}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isSending}
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSending}
                onClick={() => void handleConfirmSend()}
                className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer"
              >
                {isSending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Now</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

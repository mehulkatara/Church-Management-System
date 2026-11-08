import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { Settings, Shield, Receipt, Trophy, MessageSquare, CheckCircle, Save } from 'lucide-react';

export const SettingsScreen: React.FC = () => {
  const { activeChurch, refreshUserData } = useAuth();

  const [receiptPrefix, setReceiptPrefix] = useState(activeChurch?.receipt_prefix || 'REC/2026-27/');
  const [maskLeaderboardDefault, setMaskLeaderboardDefault] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !activeChurch) return;

    const fetchSettings = async () => {
      try {
        const { data } = await supabase
          .from('church_settings')
          .select('*')
          .eq('church_id', activeChurch.id)
          .eq('setting_key', 'leaderboard')
          .maybeSingle();

        if (data?.setting_value?.mask_names_by_default !== undefined) {
          setMaskLeaderboardDefault(Boolean(data.setting_value.mask_names_by_default));
        }
      } catch (err) {
        console.error('Error fetching settings:', err);
      }
    };

    fetchSettings();
  }, [activeChurch]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch) return;

    setIsSaving(true);
    setSuccessMessage(null);

    try {
      // 1. Update church receipt prefix
      await supabase
        .from('churches')
        .update({ receipt_prefix: receiptPrefix.trim() })
        .eq('id', activeChurch.id);

      // 2. Update church settings for leaderboard
      await supabase.from('church_settings').upsert({
        church_id: activeChurch.id,
        setting_key: 'leaderboard',
        setting_value: { mask_names_by_default: maskLeaderboardDefault },
      });

      setSuccessMessage('Church settings successfully updated!');
      await refreshUserData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setIsSaving(false);
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
          Operational preferences for <strong className="text-slate-200">{activeChurch?.name}</strong>
        </p>
      </div>

      {successMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-xs"
      >
        {/* Receipt Prefix */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Receipt className="w-4 h-4 text-sky-400" />
            <span>Receipt Book Prefix Suggestion</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            When paper receipt books restart every financial year, this prefix will be suggested in
            the donation entry form. Staff can still modify or complete the manual receipt number.
          </p>
          <input
            type="text"
            value={receiptPrefix}
            onChange={(e) => setReceiptPrefix(e.target.value)}
            required
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white font-mono text-sm focus:outline-none focus:border-sky-500"
          />
        </div>

        {/* Leaderboard Privacy */}
        <div className="pt-4 border-t border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span>Leaderboard Privacy Policy</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            By default, donor names are masked (e.g. "John D***") to protect personal financial
            confidentiality while acknowledging church stewardship.
          </p>

          <label className="flex items-center gap-2.5 p-3 bg-slate-950 rounded-xl border border-slate-800 cursor-pointer text-slate-300">
            <input
              type="checkbox"
              checked={maskLeaderboardDefault}
              onChange={(e) => setMaskLeaderboardDefault(e.target.checked)}
              className="rounded bg-slate-900 border-slate-700 text-sky-500"
            />
            <span>Default to masked donor identities on church leaderboard</span>
          </label>
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

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2.5 px-5 rounded-xl transition-colors shadow-lg shadow-sky-600/20 cursor-pointer flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Saving...' : 'Save Settings'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};

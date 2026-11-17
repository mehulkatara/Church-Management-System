import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { buildAutoReceiptPrefix } from '../../lib/domain-logic';
import { Settings, Receipt, MessageSquare } from 'lucide-react';

export const SettingsScreen: React.FC = () => {
  const { activeChurch } = useAuth();
  const sampleAutoPrefix = buildAutoReceiptPrefix(activeChurch?.code, new Date());

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Settings className="w-5 h-5 text-sky-400" />
          <span>Church Administration Settings</span>
        </h1>
        <p className="text-xs text-slate-400">
          Operational configuration for <strong className="text-slate-200">{activeChurch?.name}</strong>
        </p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-xs">
        {/* Automatic Receipt Format (Read-only explanation) */}
        <div className="space-y-2">
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

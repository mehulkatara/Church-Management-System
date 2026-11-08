import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { AuditLog } from '../../types/database';
import {
  History,
  Search,
  Filter,
  ShieldAlert,
  Calendar,
  User,
  ArrowRight,
  Clock,
  Layers,
} from 'lucide-react';

export const AuditHistoryScreen: React.FC = () => {
  const { activeChurch } = useAuth();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchAction, setSearchAction] = useState('');
  const [selectedEntity, setSelectedEntity] = useState('');

  useEffect(() => {
    if (!supabase || !activeChurch) return;

    const fetchAuditLogs = async () => {
      setIsLoading(true);
      try {
        let query = supabase
          .from('audit_logs')
          .select('*')
          .eq('church_id', activeChurch.id)
          .order('created_at', { ascending: false })
          .limit(100);

        if (selectedEntity) {
          query = query.eq('entity_type', selectedEntity);
        }

        const { data, error } = await query;
        if (error) throw error;
        setLogs((data || []) as AuditLog[]);
      } catch (err) {
        console.error('Error fetching audit logs:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAuditLogs();
  }, [activeChurch, selectedEntity]);

  const filteredLogs = logs.filter((log) => {
    if (searchAction) {
      const term = searchAction.toLowerCase();
      const matchAction = log.action.toLowerCase().includes(term);
      const matchSummary = log.change_summary.toLowerCase().includes(term);
      const matchReason = log.reason && log.reason.toLowerCase().includes(term);
      if (!matchAction && !matchSummary && !matchReason) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <History className="w-5 h-5 text-sky-400" />
            <span>Church Audit Trail</span>
          </h1>
          <p className="text-xs text-slate-400">
            Append-only, immutable activity records for{' '}
            <strong className="text-slate-200">{activeChurch?.name}</strong>
          </p>
        </div>

        <div className="text-right">
          <span className="text-[11px] font-mono bg-purple-500/10 text-purple-300 border border-purple-500/30 px-3 py-1 rounded-lg">
            Role Policy: Append-Only / Permanent
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchAction}
            onChange={(e) => setSearchAction(e.target.value)}
            placeholder="Search action, summary, or reason..."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <select
          value={selectedEntity}
          onChange={(e) => setSelectedEntity(e.target.value)}
          className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
        >
          <option value="">All Entities</option>
          <option value="donation">Donations</option>
          <option value="member">Members</option>
          <option value="access_request">Access Requests</option>
          <option value="church">Church Settings</option>
        </select>
      </div>

      {/* Audit Log List */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="divide-y divide-slate-800/60 text-xs">
          {isLoading ? (
            <div className="py-8 text-center text-slate-500">Loading audit history...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="py-8 text-center text-slate-500">No audit events found.</div>
          ) : (
            filteredLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-slate-800/40 transition-colors space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">
                      {log.action}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Entity: {log.entity_type} #{log.entity_id}
                    </span>
                  </div>

                  <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    {new Date(log.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </span>
                </div>

                <p className="text-white font-medium">{log.change_summary}</p>

                {log.reason && (
                  <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-lg">
                    <strong>Mandatory Reason:</strong> {log.reason}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

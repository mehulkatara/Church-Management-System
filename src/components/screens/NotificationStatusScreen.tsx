import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { NotificationJob } from '../../types/database';
import {
  MessageSquare,
  Smartphone,
  Server,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
  XCircle,
  HelpCircle,
  RotateCcw,
} from 'lucide-react';

export const NotificationStatusScreen: React.FC = () => {
  const { activeChurch } = useAuth();

  const [activeTab, setActiveTab] = useState<'mode_a' | 'mode_b'>('mode_a');
  const [jobs, setJobs] = useState<NotificationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState<string | null>(null);

  const fetchJobs = async () => {
    if (!supabase || !activeChurch) return;
    setIsLoading(true);

    try {
      const { data, error } = await supabase
        .from('notification_jobs')
        .select('*')
        .eq('church_id', activeChurch.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setJobs((data || []) as NotificationJob[]);
    } catch (err) {
      console.error('Error fetching notification jobs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [activeChurch]);

  const handleRetryJob = async (jobId: string) => {
    if (!supabase) return;
    setIsRetrying(jobId);

    try {
      await supabase
        .from('notification_jobs')
        .update({
          status: 'queued',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      await fetchJobs();
    } catch (err) {
      console.error('Retry failed:', err);
    } finally {
      setIsRetrying(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'submitted':
      case 'delivered':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'queued':
        return 'bg-sky-500/20 text-sky-300 border-sky-500/30';
      case 'not_configured':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'failed':
        return 'bg-red-500/20 text-red-300 border-red-500/30';
      default:
        return 'bg-slate-700 text-slate-300 border-slate-600';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-sky-400" />
            <span>Donation SMS Confirmations</span>
          </h1>
          <p className="text-xs text-slate-400">
            Church: <strong className="text-slate-200">{activeChurch?.name}</strong> &bull; Two
            Clearly Separated Modes
          </p>
        </div>

        {/* Mode Selector Tabs */}
        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs font-medium">
          <button
            onClick={() => setActiveTab('mode_a')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'mode_a'
                ? 'bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Mode A: Send From Phone</span>
          </button>
          <button
            onClick={() => setActiveTab('mode_b')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'mode_b'
                ? 'bg-sky-500/20 text-sky-300 font-semibold border border-sky-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Mode B: Automatic Gateway</span>
          </button>
        </div>
      </div>

      {/* MODE A: Send From My Phone */}
      {activeTab === 'mode_a' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-white">
                  Mode A: Phone-Based SMS Workflow
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Recommended for church collectors and pastors recording donations on mobile devices.
                  Zero external gateway costs or carrier registration fees.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 text-xs pt-2">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  1. Save Donation First
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  The donation is saved and receipt permanently reserved in the database before any SMS actions.
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <Send className="w-4 h-4 text-sky-400" />
                  2. Native SMS Composer
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Clicking "Send SMS from my phone" launches the phone's native messaging app with recipient &amp; text.
                </p>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-amber-400" />
                  3. Honest Activity Logging
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Composer request is recorded separately. The app does not pretend it verified carrier delivery.
                </p>
              </div>
            </div>

            {/* Standard Template Preview */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Official SMS Format:
              </span>
              <p className="font-mono text-xs text-sky-300 bg-slate-900 p-3 rounded-lg border border-slate-800">
                “Thank you, {'{member_name}'}. {'{church_name}'} has recorded your donation of INR{' '}
                {'{amount}'} towards {'{category}'} on {'{donation_date}'}. Receipt:{' '}
                {'{receipt_number}'}.”
              </p>
            </div>
          </div>
        </div>
      )}

      {/* MODE B: Automatic SMS Provider Gateway */}
      {activeTab === 'mode_b' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                <Server className="w-5 h-5" />
              </div>
              <div className="space-y-1 flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white">
                    Mode B: Automatic SMS Provider Integration
                  </h3>
                  <span className="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full font-mono font-semibold">
                    Status: Provider Not Configured
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Requires server-side SMS credentials (e.g., Kaleyra, Twilio, or Fast2SMS DLT registration).
                  Keep credentials strictly in Supabase Vault / Edge Function secrets—never in browser code.
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                <strong>Specification Mandate:</strong> Automatic mode remains disabled until real credentials
                are configured. SMS failure never undoes saved donations.
              </span>
            </div>
          </div>

          {/* Job Queue Table */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="px-5 py-3 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <span className="text-xs font-semibold text-white tracking-tight">
                Durable Notification Jobs Queue
              </span>
              <button
                onClick={fetchJobs}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Queue</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-400 font-medium">
                    <th className="py-2.5 px-4">Recipient</th>
                    <th className="py-2.5 px-4 font-mono">Phone</th>
                    <th className="py-2.5 px-4">Message Snippet</th>
                    <th className="py-2.5 px-4 text-center">Attempts</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        Loading notification queue...
                      </td>
                    </tr>
                  ) : jobs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No notification jobs queued.
                      </td>
                    </tr>
                  ) : (
                    jobs.map((job) => (
                      <tr key={job.id} className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-semibold text-white">
                          {job.recipient_name}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-400">
                          {job.recipient_phone}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 max-w-xs truncate">
                          {job.message_body}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono">{job.attempts_count}</td>
                        <td className="py-2.5 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${getStatusBadge(
                              job.status
                            )}`}
                          >
                            {job.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {job.status === 'failed' && (
                            <button
                              onClick={() => handleRetryJob(job.id)}
                              disabled={isRetrying === job.id}
                              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-sky-400 text-[11px] rounded transition-colors flex items-center gap-1 ml-auto"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>{isRetrying === job.id ? 'Retrying...' : 'Retry'}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

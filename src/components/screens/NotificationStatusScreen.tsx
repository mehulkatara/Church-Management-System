import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { NotificationJob, AndroidSmsGatewayStatus } from '../../types/database';
import {
  getChurchSmsGatewayStatus,
  retrySmsJob,
  syncSmsJobStatus,
} from '../../lib/sms-gateway';
import {
  MessageSquare,
  Server,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  Loader2,
  AlertCircle,
} from 'lucide-react';

export const NotificationStatusScreen: React.FC = () => {
  const { activeChurch } = useAuth();

  const [gatewayStatus, setGatewayStatus] = useState<AndroidSmsGatewayStatus | null>(null);
  const [jobs, setJobs] = useState<NotificationJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionJobId, setActionJobId] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    if (!supabase || !activeChurch) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    try {
      const [gw, jobsRes] = await Promise.all([
        getChurchSmsGatewayStatus(activeChurch.id),
        supabase
          .from('notification_jobs')
          .select('*')
          .eq('church_id', activeChurch.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      setGatewayStatus(gw);
      if (jobsRes.error) throw jobsRes.error;
      setJobs((jobsRes.data || []) as NotificationJob[]);
    } catch (err) {
      console.error('Error fetching notification jobs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeChurch]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRetryJob = async (jobId: string) => {
    setActionJobId(jobId);
    setActionBanner(null);
    try {
      const res = await retrySmsJob(jobId);
      setActionBanner({ ok: res.ok, text: res.message });
      await fetchData();
    } catch (err: unknown) {
      setActionBanner({
        ok: false,
        text: err instanceof Error ? err.message : 'Retry failed.',
      });
    } finally {
      setActionJobId(null);
    }
  };

  const handleSyncStatus = async (jobId: string) => {
    setActionJobId(jobId);
    setActionBanner(null);
    try {
      const res = await syncSmsJobStatus(jobId);
      setActionBanner({ ok: res.ok, text: res.message });
      await fetchData();
    } catch (err: unknown) {
      setActionBanner({
        ok: false,
        text: err instanceof Error ? err.message : 'Status check failed.',
      });
    } finally {
      setActionJobId(null);
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'submitted':
      case 'delivered':
        return 'text-emerald-400';
      case 'queued':
        return 'text-sky-400';
      case 'not_configured':
        return 'text-amber-300';
      case 'failed':
        return 'text-red-400';
      default:
        return 'text-slate-400';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-sky-400" />
            <span>SMS Confirmations (Android SMS Gateway)</span>
          </h1>
          <p className="text-xs text-slate-400">
            Church: <strong className="text-slate-200">{activeChurch?.name}</strong> &middot; Plan B
            Automatic Gateway Delivery
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchData()}
          className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs text-slate-200 flex items-center gap-1.5 transition-colors self-start sm:self-auto cursor-pointer whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Plan B Gateway Status Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-white">
                Android SMS Gateway &middot; Cloud Server
              </h2>
              <span
                className={`text-xs font-mono font-semibold flex items-center gap-1.5 ${
                  gatewayStatus?.configured && gatewayStatus.enabled
                    ? 'text-emerald-400'
                    : gatewayStatus?.configured
                    ? 'text-amber-300'
                    : 'text-amber-300'
                }`}
              >
                {gatewayStatus?.configured && gatewayStatus.enabled ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Active &amp; Enabled</span>
                  </>
                ) : gatewayStatus?.configured ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Paused in Settings</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Not Configured</span>
                  </>
                )}
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Automatically dispatches donation receipts via{' '}
              <span className="font-mono text-sky-300">
                {gatewayStatus?.api_url || 'https://api.sms-gate.app/3rdparty/v1'}
              </span>
              {gatewayStatus?.username ? (
                <>
                  {' '}
                  &middot; Account <span className="font-mono text-slate-200">{gatewayStatus.username}</span>
                </>
              ) : null}
              {gatewayStatus?.sim_number ? (
                <>
                  {' '}
                  &middot; SIM <span className="font-mono">{gatewayStatus.sim_number}</span>
                </>
              ) : null}
              . Credentials remain strictly server-side; SMS failures never undo saved donations.
            </p>
          </div>
        </div>

        {!gatewayStatus?.configured && (
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              <strong>Setup Required:</strong> Configure your Cloud Server username and password from
              the Android SMS Gateway app under <strong>Settings &rarr; SMS Delivery</strong>.
            </span>
          </div>
        )}
      </div>

      {actionBanner && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 ${
            actionBanner.ok
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
              : 'bg-red-500/10 border-red-500/20 text-red-300'
          }`}
        >
          {actionBanner.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{actionBanner.text}</span>
        </div>
      )}

      {/* Durable Notification Jobs Queue */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-xs font-semibold text-white tracking-tight">
            SMS Delivery Queue &amp; History
          </span>
          <span className="text-[11px] font-mono tabular-nums text-slate-400">
            {jobs.length} record{jobs.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-400 font-medium">
                <th className="py-2.5 px-4">Recipient</th>
                <th className="py-2.5 px-4 font-mono">Phone</th>
                <th className="py-2.5 px-4">Message</th>
                <th className="py-2.5 px-4 text-center">Attempts</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading SMS delivery queue...
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No SMS deliveries recorded yet.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => {
                  const isBusy = actionJobId === job.id;
                  const canRetry =
                    job.status === 'failed' ||
                    job.status === 'not_configured' ||
                    job.status === 'queued';
                  const canSync =
                    job.status === 'submitted' && Boolean(job.external_id);

                  return (
                    <tr key={job.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-semibold text-white">
                        {job.recipient_name}
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {job.recipient_phone}
                      </td>
                      <td className="py-2.5 px-4 max-w-xs">
                        <div className="text-slate-300 truncate" title={job.message_body}>
                          {job.message_body}
                        </div>
                        {job.error_message && (
                          <div className="text-[11px] text-red-400 truncate mt-0.5" title={job.error_message}>
                            {job.error_message}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center font-mono tabular-nums">
                        {job.attempts_count}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`font-mono font-semibold text-[11px] uppercase ${getStatusClass(job.status)}`}>
                          {job.status.replace('_', ' ')}
                        </span>
                        {job.external_id && (
                          <div className="text-[10px] font-mono text-slate-500 truncate max-w-[130px]">
                            ID: {job.external_id}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {canRetry && (
                          <button
                            type="button"
                            onClick={() => void handleRetryJob(job.id)}
                            disabled={isBusy}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-sky-400 text-[11px] font-medium rounded-lg border border-slate-700 transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3 h-3" />
                            )}
                            <span>{isBusy ? 'Sending...' : 'Retry'}</span>
                          </button>
                        )}
                        {canSync && (
                          <button
                            type="button"
                            onClick={() => void handleSyncStatus(job.id)}
                            disabled={isBusy}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-200 text-[11px] font-medium rounded-lg border border-slate-700 transition-colors inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <RefreshCw className="w-3 h-3" />
                            )}
                            <span>Sync</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

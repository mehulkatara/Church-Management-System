import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Clock, Building2, CheckCircle2, RefreshCw, LogOut, ShieldCheck } from 'lucide-react';

export const ApprovalStatusScreen: React.FC = () => {
  const { user, profile, pendingRequests, refreshUserData, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6">
        {/* Status Icon */}
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
          <Clock className="w-8 h-8" />
        </div>

        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold text-white tracking-tight">
            Member Access Pending Approval
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
            Welcome, <strong className="text-slate-200">{profile?.full_name || user?.email}</strong>.
            Your registration has been received and is waiting for accountant verification.
          </p>
        </div>

        {/* Request Details */}
        <div className="bg-slate-950 rounded-2xl p-5 border border-slate-800 space-y-3">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Pending Request Details
          </div>

          {pendingRequests.length > 0 ? (
            pendingRequests.map((req) => (
              <div
                key={req.id}
                className="bg-slate-900 p-3.5 rounded-xl border border-slate-800/80 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-sky-400" />
                    Church:
                  </span>
                  <span className="text-white font-medium">
                    {req.church ? req.church.name : 'Requested Church'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Status:</span>
                  <span className="bg-amber-500/20 text-amber-300 font-mono text-[10px] px-2 py-0.5 rounded border border-amber-500/30 uppercase font-semibold">
                    {req.status}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Requested On:</span>
                  <span className="text-slate-300 font-mono text-[11px]">
                    {new Date(req.requested_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-xs text-slate-400 py-2">
              No active pending requests found. If an Accountant has already approved your access, please click "Refresh Status" below.
            </div>
          )}
        </div>

        {/* Security & Verification Explanation */}
        <div className="bg-sky-950/30 border border-sky-500/20 rounded-2xl p-4 text-xs text-slate-300 space-y-2">
          <div className="flex items-center gap-2 text-sky-400 font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Why is accountant verification required?</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            To ensure absolute financial and personal privacy, accounts are verified by an authorized church Accountant.
            The Accountant will link your authenticated login with your official member record and record
            Village and Gender data. Once verified, you will immediately gain access to your donation statements and rank.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => refreshUserData()}
            className="flex-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-sky-600/20"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh Status</span>
          </button>

          <button
            onClick={() => signOut()}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold py-2.5 px-4 rounded-xl border border-slate-700 transition-colors flex items-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};

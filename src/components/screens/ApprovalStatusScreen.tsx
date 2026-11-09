import React from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  Clock,
  Building2,
  AlertTriangle,
  RefreshCw,
  LogOut,
  ShieldCheck,
  Edit3,
  Calendar,
  Phone,
  MapPin,
  XCircle,
} from 'lucide-react';

interface ApprovalStatusScreenProps {
  onEditProfile?: () => void;
}

export const ApprovalStatusScreen: React.FC<ApprovalStatusScreenProps> = ({
  onEditProfile,
}) => {
  const { user, profile, activeRequest, refreshUserData, signOut } = useAuth();

  const isReturned = activeRequest?.status === 'returned_for_correction';
  const isRejected = activeRequest?.status === 'rejected';

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4 py-8">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6">
        {/* Status Icon */}
        <div
          className={`w-16 h-16 rounded-3xl flex items-center justify-center mx-auto shadow-inner ${
            isReturned
              ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
              : isRejected
              ? 'bg-red-500/10 border border-red-500/30 text-red-400'
              : 'bg-sky-500/10 border border-sky-500/30 text-sky-400'
          }`}
        >
          {isReturned ? (
            <AlertTriangle className="w-8 h-8" />
          ) : isRejected ? (
            <XCircle className="w-8 h-8" />
          ) : (
            <Clock className="w-8 h-8" />
          )}
        </div>

        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {isReturned
              ? 'Application Returned for Correction'
              : isRejected
              ? 'Member Access Request Declined'
              : 'Awaiting Church Accountant Review'}
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">
            Authenticated as <strong className="text-slate-200">{user?.email || profile?.email}</strong>.
            {isReturned
              ? ' Your church Accountant has reviewed your application and requested corrections.'
              : isRejected
              ? ' Your application could not be verified by the church Accountant.'
              : ' Your profile has been submitted and is currently in the Accountant verification queue.'}
          </p>
        </div>

        {/* Feedback Reason Banner (for returned or rejected requests) */}
        {(isReturned || isRejected) && activeRequest?.decision_reason && (
          <div
            className={`rounded-2xl p-4 text-xs space-y-1.5 border ${
              isReturned
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                : 'bg-red-500/10 border-red-500/30 text-red-200'
            }`}
          >
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Accountant Review Feedback:</span>
            </div>
            <p className="leading-relaxed pl-5 font-mono text-[11px] bg-slate-950/40 p-2.5 rounded-xl border border-white/5">
              "{activeRequest.decision_reason}"
            </p>
          </div>
        )}

        {/* Submitted Application Details */}
        {activeRequest && (
          <div className="bg-slate-950 rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <span>Submitted Application</span>
              <span className="text-sky-400 font-mono text-[11px]">v{activeRequest.submission_version || 1}</span>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-sky-400" />
                  Target Church:
                </span>
                <span className="text-white font-medium">
                  {activeRequest.church ? activeRequest.church.name : 'Selected Church'}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400">Applicant Name:</span>
                <span className="text-slate-200 font-medium">{activeRequest.applicant_name}</span>
              </div>

              {activeRequest.date_of_birth && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    Date of Birth:
                  </span>
                  <span className="text-slate-200 font-mono">{activeRequest.date_of_birth}</span>
                </div>
              )}

              {activeRequest.applicant_phone && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-500" />
                    Phone:
                  </span>
                  <span className="text-slate-200 font-mono">{activeRequest.applicant_phone}</span>
                </div>
              )}

              {activeRequest.village_name && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-500" />
                    Village / City Name:
                  </span>
                  <span className="text-slate-200">{activeRequest.village_name}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Submitted On:</span>
                <span className="text-slate-300 font-mono text-[11px]">
                  {new Date(activeRequest.requested_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Verification Explanation */}
        <div className="bg-sky-950/30 border border-sky-500/20 rounded-2xl p-4 text-xs text-slate-300 space-y-2">
          <div className="flex items-center gap-2 text-sky-400 font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>Why is church Accountant verification required?</span>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Church financial transparency requires that access to donation records, receipts,
            and leaderboards is linked strictly to verified church members. An authorized
            church Accountant reviews your submitted information and maps it to your official
            member roster entry.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
          {isReturned && onEditProfile && (
            <button
              onClick={onEditProfile}
              className="w-full sm:flex-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-600/20"
            >
              <Edit3 className="w-4 h-4" />
              <span>Edit &amp; Resubmit Profile</span>
            </button>
          )}

          <button
            onClick={() => refreshUserData()}
            className="w-full sm:flex-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-sky-600/20"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh Status</span>
          </button>

          <button
            onClick={() => signOut()}
            className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold py-2.5 px-4 rounded-xl border border-slate-700 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};

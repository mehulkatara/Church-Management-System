import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { AccessRequest, Member, Gender } from '../../types/database';
import { Modal, ReasonModal } from '../common/Modals';
import {
  UserCheck,
  UserX,
  Search,
  CheckCircle2,
  AlertCircle,
  Building2,
  Clock,
  Phone,
  Mail,
  UserPlus,
  Link as LinkIcon,
  ShieldCheck,
} from 'lucide-react';

export const AccessApprovalsScreen: React.FC = () => {
  const { activeChurch, refreshUserData } = useAuth();

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');

  // Approval Modal State
  const [selectedRequest, setSelectedRequest] = useState<AccessRequest | null>(null);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [approvalMode, setApprovalMode] = useState<'link_existing' | 'create_new'>('link_existing');
  const [chosenMemberId, setChosenMemberId] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [villageName, setVillageName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reject Modal State
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectTargetRequest, setRejectTargetRequest] = useState<AccessRequest | null>(null);

  const fetchRequestsAndMembers = async () => {
    if (!supabase || !activeChurch) return;
    setIsLoading(true);

    try {
      const { data: reqData } = await supabase
        .from('access_requests')
        .select('*, church:churches(*)')
        .eq('church_id', activeChurch.id)
        .order('requested_at', { ascending: false });

      if (reqData) setRequests(reqData as AccessRequest[]);

      const { data: memData } = await supabase
        .from('members')
        .select('*')
        .eq('church_id', activeChurch.id)
        .order('full_name');

      if (memData) setMembers(memData as Member[]);
    } catch (err) {
      console.error('Error fetching access requests:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequestsAndMembers();
  }, [activeChurch]);

  const openApproveModal = (req: AccessRequest) => {
    setSelectedRequest(req);
    setNewMemberName(req.applicant_name);
    setChosenMemberId(members[0]?.id || '');
    setVillageName('');
    setGender('');
    setApprovalMode('link_existing');
    setActionError(null);
    setIsApproveModalOpen(true);
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !selectedRequest) return;

    setIsSubmitting(true);
    setActionError(null);

    try {
      const { data, error } = await supabase.rpc('approve_access_request', {
        p_request_id: selectedRequest.id,
        p_member_id: approvalMode === 'link_existing' ? chosenMemberId : null,
        p_create_member_name: approvalMode === 'create_new' ? newMemberName.trim() : null,
        p_village_name: villageName.trim() || null,
        p_gender: gender || null,
      });

      if (error) throw error;

      setIsApproveModalOpen(false);
      setSelectedRequest(null);
      await fetchRequestsAndMembers();
      await refreshUserData();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Approval failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReject = async (reason: string) => {
    if (!supabase || !rejectTargetRequest) return;
    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('access_requests')
        .update({
          status: 'rejected',
          decided_at: new Date().toISOString(),
          decision_reason: reason,
        })
        .eq('id', rejectTargetRequest.id);

      if (error) throw error;

      setIsRejectModalOpen(false);
      setRejectTargetRequest(null);
      await fetchRequestsAndMembers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Rejection failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredRequests = requests.filter((r) => r.status === statusFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-sky-400" />
            <span>Member Access Approvals</span>
          </h1>
          <p className="text-xs text-slate-400">
            Accountant verification queue for{' '}
            <strong className="text-slate-200">{activeChurch?.name}</strong>
          </p>
        </div>

        {/* Tab Filters */}
        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs font-medium">
          <button
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
              statusFilter === 'pending'
                ? 'bg-amber-500/20 text-amber-300 font-semibold border border-amber-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Pending ({requests.filter((r) => r.status === 'pending').length})</span>
          </button>
          <button
            onClick={() => setStatusFilter('approved')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              statusFilter === 'approved'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Approved
          </button>
          <button
            onClick={() => setStatusFilter('rejected')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              statusFilter === 'rejected'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Rejected
          </button>
        </div>
      </div>

      {/* Info Notice */}
      <div className="bg-sky-950/30 border border-sky-500/20 rounded-2xl p-4 text-xs text-slate-300 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <strong className="text-white block font-semibold">Accountant Verification Protocol</strong>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Public self-registration creates unverified pending accounts. As an Accountant, you verify the applicant's
            identity, choose whether to link them to an existing church member or register a new one, record optional
            Village Name and Gender, and grant Member access.
          </p>
        </div>
      </div>

      {/* Requests Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                <th className="py-3 px-4">Applicant</th>
                <th className="py-3 px-4">Email Address</th>
                <th className="py-3 px-4">Phone</th>
                <th className="py-3 px-4">Requested On</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading access requests...
                  </td>
                </tr>
              ) : filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No {statusFilter} access requests for this church.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4 font-semibold text-white">
                      {req.applicant_name}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {req.applicant_email}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {req.applicant_phone || 'None'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {new Date(req.requested_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                          req.status === 'pending'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : req.status === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : 'bg-red-500/20 text-red-300 border-red-500/30'
                        }`}
                      >
                        {req.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      {req.status === 'pending' && (
                        <>
                          <button
                            onClick={() => openApproveModal(req)}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            Verify &amp; Approve
                          </button>
                          <button
                            onClick={() => {
                              setRejectTargetRequest(req);
                              setIsRejectModalOpen(true);
                            }}
                            className="px-3 py-1 bg-slate-800 hover:bg-red-950/60 text-red-400 hover:text-red-300 rounded-lg transition-colors cursor-pointer"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {req.status !== 'pending' && (
                        <span className="text-slate-500 text-[11px] font-mono">
                          {req.decided_at
                            ? `Decided ${new Date(req.decided_at).toLocaleDateString('en-IN')}`
                            : 'Resolved'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* VERIFY & APPROVE MODAL */}
      {isApproveModalOpen && selectedRequest && (
        <Modal
          isOpen={isApproveModalOpen}
          onClose={() => setIsApproveModalOpen(false)}
          title={`Verify Applicant: ${selectedRequest.applicant_name}`}
          maxWidth="lg"
        >
          <form onSubmit={handleApproveSubmit} className="space-y-4 text-xs">
            {actionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {actionError}
              </div>
            )}

            {/* Applicant Summary */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Applicant Name:</span>
                <span className="text-white font-medium">{selectedRequest.applicant_name}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Email:</span>
                <span className="text-white font-mono">{selectedRequest.applicant_email}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Phone:</span>
                <span className="text-white font-mono">{selectedRequest.applicant_phone || 'None'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Target Church:</span>
                <span className="text-sky-300">{activeChurch?.name}</span>
              </div>
            </div>

            {/* Approval Mode Selection */}
            <div className="space-y-1.5">
              <label className="block text-slate-300 font-semibold">Member Assignment</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setApprovalMode('link_existing')}
                  className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                    approvalMode === 'link_existing'
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <LinkIcon className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-white text-xs">Link Existing Member</strong>
                    <span className="text-[10px] text-slate-400">
                      Match with an existing church roster entry
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setApprovalMode('create_new')}
                  className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                    approvalMode === 'create_new'
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <UserPlus className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-white text-xs">Create New Member</strong>
                    <span className="text-[10px] text-slate-400">
                      Generate new member number in this church
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Existing Member Select */}
            {approvalMode === 'link_existing' && (
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Select Existing Church Member <span className="text-red-400">*</span>
                </label>
                <select
                  value={chosenMemberId}
                  onChange={(e) => setChosenMemberId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name} ({m.member_number}) {m.village_name ? `- ${m.village_name}` : ''}{' '}
                      [{m.membership_status}]
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Note: Approving access for an existing inactive member does not reactivate them.
                </p>
              </div>
            )}

            {/* Create New Member Name */}
            {approvalMode === 'create_new' && (
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Member Full Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>
            )}

            {/* Optional Accountant-Entered Fields: Village & Gender */}
            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-800">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Village Name <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={villageName}
                  onChange={(e) => setVillageName(e.target.value)}
                  placeholder="e.g. Guindy / Tambaram"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Gender <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender | '')}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="">-- Not Provided (NULL) --</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
            </div>

            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-[11px]">
              Approval links this verified authentication account to the member record and grants
              <strong> Member</strong> role only. Only Platform Admin can assign staff roles.
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsApproveModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-600/20"
              >
                {isSubmitting ? 'Verifying & Linking...' : 'Confirm Approval & Link'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* REJECT MODAL */}
      <ReasonModal
        isOpen={isRejectModalOpen}
        onClose={() => {
          setIsRejectModalOpen(false);
          setRejectTargetRequest(null);
        }}
        onConfirm={handleConfirmReject}
        title="Reject Access Request"
        description="Please provide an audit reason for rejecting this member access application."
        confirmLabel="Reject Application"
        isDestructive={true}
        isLoading={isSubmitting}
      />
    </div>
  );
};

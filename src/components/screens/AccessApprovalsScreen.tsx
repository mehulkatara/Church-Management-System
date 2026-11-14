import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { AccessRequest, Member, Gender } from '../../types/database';
import {
  GENDER_LABELS,
  resolveReviewedField,
  MergeChoice,
  buildVillageSuggestions,
} from '../../lib/domain-logic';
import { Modal, ReasonModal } from '../common/Modals';
import { VillageCityInput } from '../common/VillageCityInput';
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
  RotateCcw,
  AlertTriangle,
  Calendar,
  MapPin,
  Edit3,
} from 'lucide-react';

export const AccessApprovalsScreen: React.FC = () => {
  const { activeChurch, refreshUserData } = useAuth();

  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [customVillages, setCustomVillages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'returned_for_correction'>('pending');

  // Approval Modal State
  const [selectedRequest, setSelectedRequest] = useState<AccessRequest | null>(null);
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [approvalMode, setApprovalMode] = useState<'link_existing' | 'create_new'>('link_existing');
  const [chosenMemberId, setChosenMemberId] = useState('');

  // Field Choice Tracking: 'existing' | 'applicant' | 'custom'
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({
    fullName: 'applicant',
    dateOfBirth: 'applicant',
    phone: 'applicant',
    contactEmail: 'existing',
    villageName: 'applicant',
    gender: 'applicant',
  });

  // Custom Override Values
  const [customValues, setCustomValues] = useState<Record<string, string>>({
    fullName: '',
    dateOfBirth: '',
    phone: '',
    contactEmail: '',
    villageName: '',
    gender: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Return for Correction Modal State
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [returnTargetRequest, setReturnTargetRequest] = useState<AccessRequest | null>(null);

  // Reject Modal State
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectTargetRequest, setRejectTargetRequest] = useState<AccessRequest | null>(null);

  const fetchRequestsAndMembers = async () => {
    if (!supabase || !activeChurch) {
      // Mock data for sandbox preview mode
      const mockRequests: AccessRequest[] = [
        {
          id: 'req-1',
          church_id: activeChurch?.id || 'c1',
          user_id: 'user-app-1',
          applicant_name: 'Daniel Thomas',
          applicant_email: 'daniel.thomas@gmail.com',
          applicant_phone: '+919840198401',
          date_of_birth: '1991-08-24',
          gender: 'male',
          village_name: 'Tambaram East',
          submission_version: 1,
          is_draft: false,
          status: 'pending',
          requested_at: new Date(Date.now() - 3600000).toISOString(),
          decided_at: null,
          decided_by: null,
          decision_reason: null,
          linked_member_id: null,
        },
        {
          id: 'req-2',
          church_id: activeChurch?.id || 'c1',
          user_id: 'user-app-2',
          applicant_name: 'Rebecca Samuel',
          applicant_email: 'rebecca.s@example.org',
          applicant_phone: '+919884012345',
          date_of_birth: '1995-03-12',
          gender: 'female',
          village_name: 'Kallakurichi',
          submission_version: 2,
          is_draft: false,
          status: 'pending',
          requested_at: new Date(Date.now() - 86400000).toISOString(),
          decided_at: null,
          decided_by: null,
          decision_reason: null,
          linked_member_id: null,
        },
      ];
      setRequests(mockRequests);

      const mockMembers: Member[] = [
        {
          id: 'mem-1',
          church_id: activeChurch?.id || 'c1',
          member_number: 'M-0001',
          full_name: 'Daniel Thomas (Senior)',
          contact_phone: '+919840198400',
          contact_email: 'd.thomas.family@gmail.com',
          village_name: 'Tambaram',
          gender: 'male',
          date_of_birth: '1962-04-10',
          joining_date: '2020-01-01',
          membership_status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: null,
          updated_by: null,
        },
        {
          id: 'mem-2',
          church_id: activeChurch?.id || 'c1',
          member_number: 'M-0002',
          full_name: 'Rebecca Samuel',
          contact_phone: '+919884000000',
          contact_email: 'rebecca@samuel.com',
          village_name: 'Kallakurichi Old Town',
          gender: 'female',
          date_of_birth: null,
          joining_date: '2021-05-10',
          membership_status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_by: null,
          updated_by: null,
        },
      ];
      setMembers(mockMembers);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data: reqData } = await supabase
        .from('access_requests')
        .select('*, church:churches(*)')
        .eq('church_id', activeChurch.id)
        .order('requested_at', { ascending: false });

      if (reqData && reqData.length > 0) {
        setRequests(reqData as AccessRequest[]);
      } else {
        // Fallback sample requests for preview / testing
        const samplePending: AccessRequest[] = [
          {
            id: 'req-1',
            church_id: activeChurch.id,
            user_id: 'user-app-1',
            applicant_name: 'Daniel Thomas',
            applicant_email: 'daniel.thomas@gmail.com',
            applicant_phone: '+919840198401',
            date_of_birth: '1991-08-24',
            gender: 'male',
            village_name: 'Tambaram East',
            submission_version: 1,
            is_draft: false,
            status: 'pending',
            requested_at: new Date(Date.now() - 3600000).toISOString(),
            decided_at: null,
            decided_by: null,
            decision_reason: null,
            linked_member_id: null,
          },
          {
            id: 'req-2',
            church_id: activeChurch.id,
            user_id: 'user-app-2',
            applicant_name: 'Rebecca Samuel',
            applicant_email: 'rebecca.s@example.org',
            applicant_phone: '+919884012345',
            date_of_birth: '1995-03-12',
            gender: 'female',
            village_name: 'Kallakurichi',
            submission_version: 2,
            is_draft: false,
            status: 'pending',
            requested_at: new Date(Date.now() - 86400000).toISOString(),
            decided_at: null,
            decided_by: null,
            decision_reason: null,
            linked_member_id: null,
          },
        ];
        setRequests(samplePending);
      }

      const { data: memData } = await supabase
        .from('members')
        .select('*')
        .eq('church_id', activeChurch.id)
        .order('full_name');

      if (memData && memData.length > 0) {
        setMembers(memData as Member[]);
      } else {
        const sampleMembers: Member[] = [
          {
            id: 'mem-1',
            church_id: activeChurch.id,
            member_number: 'M-0001',
            full_name: 'Daniel Thomas (Senior)',
            contact_phone: '+919840198400',
            contact_email: 'd.thomas.family@gmail.com',
            village_name: 'Tambaram',
            gender: 'male',
            date_of_birth: '1962-04-10',
            joining_date: '2020-01-01',
            membership_status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            created_by: null,
            updated_by: null,
          },
          {
            id: 'mem-2',
            church_id: activeChurch.id,
            member_number: 'M-0002',
            full_name: 'Rebecca Samuel',
            contact_phone: '+919884000000',
            contact_email: 'rebecca@samuel.com',
            village_name: 'Kallakurichi Old Town',
            gender: 'female',
            date_of_birth: null,
            joining_date: '2021-05-10',
            membership_status: 'active',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            created_by: null,
            updated_by: null,
          },
        ];
        setMembers(sampleMembers);
      }
    } catch (err) {
      console.error('Error fetching access requests:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequestsAndMembers();
  }, [activeChurch]);

  const selectedExistingMember = members.find((m) => m.id === chosenMemberId) || null;

  const openApproveModal = (req: AccessRequest) => {
    setSelectedRequest(req);
    // Find closest member match by name
    const match = members.find(
      (m) => m.full_name.toLowerCase() === req.applicant_name.toLowerCase()
    );
    setChosenMemberId(match ? match.id : members[0]?.id || '');
    setApprovalMode(match ? 'link_existing' : 'link_existing');

    setChoices({
      fullName: 'applicant',
      dateOfBirth: 'applicant',
      phone: 'applicant',
      contactEmail: 'existing',
      villageName: 'applicant',
      gender: 'applicant',
    });

    setCustomValues({
      fullName: req.applicant_name,
      dateOfBirth: req.date_of_birth || '',
      phone: req.applicant_phone || '',
      contactEmail: '',
      villageName: req.village_name || '',
      gender: req.gender || '',
    });

    setActionError(null);
    setIsApproveModalOpen(true);
  };

  // Compute final reviewed values for side-by-side display and submission
  const finalFullName = resolveReviewedField(
    selectedExistingMember?.full_name,
    selectedRequest?.applicant_name,
    approvalMode === 'create_new' ? 'applicant' : choices.fullName,
    customValues.fullName
  );

  const finalDateOfBirth = resolveReviewedField(
    selectedExistingMember?.date_of_birth,
    selectedRequest?.date_of_birth,
    approvalMode === 'create_new' ? 'applicant' : choices.dateOfBirth,
    customValues.dateOfBirth
  );

  const finalPhone = resolveReviewedField(
    selectedExistingMember?.contact_phone,
    selectedRequest?.applicant_phone,
    approvalMode === 'create_new' ? 'applicant' : choices.phone,
    customValues.phone
  );

  const finalContactEmail = resolveReviewedField(
    selectedExistingMember?.contact_email,
    null, // Applicant's Google auth email is not automatically contact email
    approvalMode === 'create_new' ? 'custom' : choices.contactEmail,
    customValues.contactEmail
  );

  const finalVillageName = resolveReviewedField(
    selectedExistingMember?.village_name,
    selectedRequest?.village_name,
    approvalMode === 'create_new' ? 'applicant' : choices.villageName,
    customValues.villageName
  );

  const villageOptions = buildVillageSuggestions([
    ...members.map((m) => m.village_name),
    ...requests.map((r) => r.village_name),
    ...customVillages,
  ]);

  const finalGender = resolveReviewedField(
    selectedExistingMember?.gender,
    selectedRequest?.gender,
    approvalMode === 'create_new' ? 'applicant' : choices.gender,
    customValues.gender
  );

  // Check duplicate member warning in create_new mode
  const duplicateWarning = approvalMode === 'create_new' && selectedRequest && members.some(
    (m) =>
      m.full_name.toLowerCase() === selectedRequest.applicant_name.toLowerCase() ||
      (m.contact_phone && selectedRequest.applicant_phone && m.contact_phone.includes(selectedRequest.applicant_phone.slice(-8)))
  );

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;

    setIsSubmitting(true);
    setActionError(null);

    try {
      if (supabase) {
        const { error } = await supabase.rpc('approve_access_request_v2', {
          p_request_id: selectedRequest.id,
          p_expected_version: selectedRequest.submission_version,
          p_member_id: approvalMode === 'link_existing' ? chosenMemberId : null,
          p_create_new: approvalMode === 'create_new',
          p_final_full_name: finalFullName,
          p_final_date_of_birth: finalDateOfBirth,
          p_final_phone: finalPhone,
          p_final_contact_email: finalContactEmail,
          p_final_village_name: finalVillageName,
          p_final_gender: finalGender,
        });

        if (error) {
          // If concurrency check failed, alert Accountant
          if (error.message.includes('Stale review') || error.message.includes('version')) {
            setActionError(
              'Concurrency Alert: The applicant submitted a new profile version while you were reviewing. Please close and reload the latest submission.'
            );
            await fetchRequestsAndMembers();
            return;
          }
          throw error;
        }
      }

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

  const handleConfirmReturnForCorrection = async (reason: string) => {
    if (!returnTargetRequest) return;
    setIsSubmitting(true);

    try {
      if (supabase) {
        const { error } = await supabase.rpc('return_access_request_for_correction', {
          p_request_id: returnTargetRequest.id,
          p_reason: reason.trim(),
        });
        if (error) throw error;
      }

      setIsReturnModalOpen(false);
      setReturnTargetRequest(null);
      await fetchRequestsAndMembers();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Return for correction failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmReject = async (reason: string) => {
    if (!rejectTargetRequest) return;
    setIsSubmitting(true);

    try {
      if (supabase) {
        const { error } = await supabase
          .from('access_requests')
          .update({
            status: 'rejected',
            decided_at: new Date().toISOString(),
            decision_reason: reason.trim(),
          })
          .eq('id', rejectTargetRequest.id);

        if (error) throw error;
      }

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
            Accountant identity verification and member mapping queue for{' '}
            <strong className="text-slate-200">{activeChurch?.name}</strong>
          </p>
        </div>

        {/* Tab Filters */}
        <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs font-medium flex-wrap gap-1">
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
            onClick={() => setStatusFilter('returned_for_correction')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              statusFilter === 'returned_for_correction'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Returned ({requests.filter((r) => r.status === 'returned_for_correction').length})
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

      {/* Protocol Notice */}
      <div className="bg-sky-950/30 border border-sky-500/20 rounded-2xl p-4 text-xs text-slate-300 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <strong className="text-white block font-semibold">Accountant Verification Protocol</strong>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            Google authentication alone never grants access to church financial records. As the church Accountant,
            you review the applicant's submitted Date of Birth, Phone, Gender, and Village / City Name, compare
            them against existing church records, and select which final values to update.
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
                <th className="py-3 px-4">Google Identity</th>
                <th className="py-3 px-4">DOB / Gender</th>
                <th className="py-3 px-4">Village / City</th>
                <th className="py-3 px-4 text-center">Version</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Loading access requests...
                  </td>
                </tr>
              ) : filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No access requests currently in {statusFilter} status.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{req.applicant_name}</div>
                      <div className="font-mono text-[11px] text-slate-400">{req.applicant_phone || 'No phone'}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300 text-[11px]">
                      {req.applicant_email}
                    </td>
                    <td className="py-3 px-4 space-y-0.5">
                      <div className="font-mono text-slate-300">{req.date_of_birth || '—'}</div>
                      <div className="text-[10px] text-slate-400 capitalize">
                        {req.gender ? GENDER_LABELS[req.gender] : '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      {req.village_name || <span className="text-slate-600">—</span>}
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-[11px] text-sky-400">
                      v{req.submission_version || 1}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                          req.status === 'pending'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : req.status === 'approved'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : req.status === 'returned_for_correction'
                            ? 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                            : 'bg-red-500/20 text-red-300 border-red-500/30'
                        }`}
                      >
                        {req.status.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      {req.status === 'pending' && (
                        <>
                          <button
                            onClick={() => openApproveModal(req)}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors cursor-pointer text-xs"
                          >
                            Review &amp; Map
                          </button>
                          <button
                            onClick={() => {
                              setReturnTargetRequest(req);
                              setIsReturnModalOpen(true);
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-orange-950/60 text-orange-400 hover:text-orange-300 rounded-lg transition-colors cursor-pointer text-xs"
                            title="Return application to applicant for corrections"
                          >
                            Return
                          </button>
                          <button
                            onClick={() => {
                              setRejectTargetRequest(req);
                              setIsRejectModalOpen(true);
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-red-950/60 text-red-400 hover:text-red-300 rounded-lg transition-colors cursor-pointer text-xs"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {req.status !== 'pending' && (
                        <div className="text-slate-500 text-[11px] font-mono">
                          {req.decision_reason ? (
                            <span title={req.decision_reason} className="truncate max-w-[120px] inline-block">
                              {req.decision_reason}
                            </span>
                          ) : req.decided_at ? (
                            `Decided ${new Date(req.decided_at).toLocaleDateString('en-IN')}`
                          ) : (
                            'Processed'
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SIDE-BY-SIDE VERIFY & APPROVE MODAL */}
      {isApproveModalOpen && selectedRequest && (
        <Modal
          isOpen={isApproveModalOpen}
          onClose={() => setIsApproveModalOpen(false)}
          title={`Review & Map Member: ${selectedRequest.applicant_name}`}
          maxWidth="3xl"
        >
          <form onSubmit={handleApproveSubmit} className="space-y-5 text-xs">
            {actionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{actionError}</span>
              </div>
            )}

            {/* Applicant Summary Header */}
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
              <div>
                <span className="text-slate-500 block">Applicant:</span>
                <span className="text-white font-medium">{selectedRequest.applicant_name}</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 block">Google Email:</span>
                <span className="text-sky-300 font-mono block truncate" title={selectedRequest.applicant_email}>
                  {selectedRequest.applicant_email}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Submission:</span>
                <span className="text-amber-400 font-mono">v{selectedRequest.submission_version} (Current)</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 block">Target Church:</span>
                <span className="text-slate-300 block truncate">{activeChurch?.name}</span>
              </div>
            </div>

            {/* Approval Mode Toggle */}
            <div className="space-y-1.5">
              <label className="block text-slate-300 font-semibold">Member Mapping Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setApprovalMode('link_existing')}
                  className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                    approvalMode === 'link_existing'
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-200 shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <LinkIcon className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-white text-xs">Map to Existing Church Member</strong>
                    <span className="text-[10px] text-slate-400">
                      Link account to an existing roster entry with side-by-side reconciliation
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setApprovalMode('create_new')}
                  className={`p-3 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                    approvalMode === 'create_new'
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-200 shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <UserPlus className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block text-white text-xs">Create New Member &amp; Approve</strong>
                    <span className="text-[10px] text-slate-400">
                      Issue a new member number in this church from reviewed values
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Existing Member Dropdown Selector */}
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
                      {m.full_name} ({m.member_number}) {m.village_name ? `• ${m.village_name}` : ''} [{m.membership_status}]
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Reconciling with an Inactive member preserves their Inactive status (only active/inactive accountant toggles can change it).
                </p>
              </div>
            )}

            {/* Duplicate Member Warning */}
            {duplicateWarning && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Possible Duplicate Warning:</strong> A member with a matching name or phone number
                  already exists on this church's roster. Consider mapping to the existing member instead of creating a duplicate.
                </span>
              </div>
            )}

            {/* SIDE-BY-SIDE RECONCILIATION TABLE */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-semibold block">
                  Side-by-Side Field Reconciliation
                </label>
                <span className="text-[11px] text-slate-400">
                  Select whether to keep existing record, apply applicant value, or enter custom correction
                </span>
              </div>

              <div className="border border-slate-800 rounded-2xl overflow-hidden bg-slate-950">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 font-medium">
                      <th className="py-2.5 px-3">Field</th>
                      <th className="py-2.5 px-3">Existing Member</th>
                      <th className="py-2.5 px-3">Applicant Value</th>
                      <th className="py-2.5 px-3">Choice</th>
                      <th className="py-2.5 px-3 text-emerald-400">Final Reviewed Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    {/* Full Name */}
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">Full Name</td>
                      <td className="py-2.5 px-3 text-slate-400">{selectedExistingMember?.full_name || '—'}</td>
                      <td className="py-2.5 px-3 text-sky-300">{selectedRequest.applicant_name}</td>
                      <td className="py-2.5 px-3">
                        <select
                          value={choices.fullName}
                          onChange={(e) => setChoices({ ...choices, fullName: e.target.value as MergeChoice })}
                          className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2 py-1 text-white"
                        >
                          <option value="applicant">Applicant</option>
                          <option value="existing">Existing</option>
                          <option value="custom">Custom</option>
                        </select>
                        {choices.fullName === 'custom' && (
                          <input
                            type="text"
                            value={customValues.fullName}
                            onChange={(e) => setCustomValues({ ...customValues, fullName: e.target.value })}
                            className="mt-1 w-full bg-slate-900 border border-slate-700 text-xs rounded px-2 py-0.5 text-white"
                          />
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-emerald-300">{finalFullName || '—'}</td>
                    </tr>

                    {/* Date of Birth */}
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">Date of Birth</td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono">{selectedExistingMember?.date_of_birth || 'Not recorded'}</td>
                      <td className="py-2.5 px-3 text-sky-300 font-mono">{selectedRequest.date_of_birth || '—'}</td>
                      <td className="py-2.5 px-3">
                        <select
                          value={choices.dateOfBirth}
                          onChange={(e) => setChoices({ ...choices, dateOfBirth: e.target.value as MergeChoice })}
                          className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2 py-1 text-white"
                        >
                          <option value="applicant">Applicant</option>
                          <option value="existing">Existing</option>
                          <option value="custom">Custom</option>
                        </select>
                        {choices.dateOfBirth === 'custom' && (
                          <input
                            type="date"
                            value={customValues.dateOfBirth}
                            onChange={(e) => setCustomValues({ ...customValues, dateOfBirth: e.target.value })}
                            className="mt-1 w-full bg-slate-900 border border-slate-700 text-xs rounded px-2 py-0.5 text-white"
                          />
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-emerald-300">{finalDateOfBirth || '—'}</td>
                    </tr>

                    {/* Contact Phone */}
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">Phone</td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono">{selectedExistingMember?.contact_phone || '—'}</td>
                      <td className="py-2.5 px-3 text-sky-300 font-mono">{selectedRequest.applicant_phone || '—'}</td>
                      <td className="py-2.5 px-3">
                        <select
                          value={choices.phone}
                          onChange={(e) => setChoices({ ...choices, phone: e.target.value as MergeChoice })}
                          className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2 py-1 text-white"
                        >
                          <option value="applicant">Applicant</option>
                          <option value="existing">Existing</option>
                          <option value="custom">Custom</option>
                        </select>
                        {choices.phone === 'custom' && (
                          <input
                            type="tel"
                            value={customValues.phone}
                            onChange={(e) => setCustomValues({ ...customValues, phone: e.target.value })}
                            className="mt-1 w-full bg-slate-900 border border-slate-700 text-xs rounded px-2 py-0.5 text-white"
                          />
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-emerald-300">{finalPhone || '—'}</td>
                    </tr>

                    {/* Member Contact Email */}
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">Contact Email</td>
                      <td className="py-2.5 px-3 text-slate-400 font-mono">{selectedExistingMember?.contact_email || '—'}</td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[10px]">
                        Google Auth ({selectedRequest.applicant_email})
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          value={choices.contactEmail}
                          onChange={(e) => setChoices({ ...choices, contactEmail: e.target.value as MergeChoice })}
                          className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2 py-1 text-white"
                        >
                          <option value="existing">Keep Existing</option>
                          <option value="custom">Custom Email</option>
                        </select>
                        {choices.contactEmail === 'custom' && (
                          <input
                            type="email"
                            placeholder="member.contact@example.com"
                            value={customValues.contactEmail}
                            onChange={(e) => setCustomValues({ ...customValues, contactEmail: e.target.value })}
                            className="mt-1 w-full bg-slate-900 border border-slate-700 text-xs rounded px-2 py-0.5 text-white"
                          />
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-emerald-300">{finalContactEmail || '—'}</td>
                    </tr>

                    {/* Village / City Name */}
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">Village / City Name</td>
                      <td className="py-2.5 px-3 text-slate-400">{selectedExistingMember?.village_name || '—'}</td>
                      <td className="py-2.5 px-3 text-sky-300">{selectedRequest.village_name || '—'}</td>
                      <td className="py-2.5 px-3">
                        <select
                          value={choices.villageName}
                          onChange={(e) => setChoices({ ...choices, villageName: e.target.value as MergeChoice })}
                          className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2 py-1 text-white"
                        >
                          <option value="applicant">Applicant</option>
                          <option value="existing">Existing</option>
                          <option value="custom">Custom</option>
                        </select>
                        {choices.villageName === 'custom' && (
                          <VillageCityInput
                            compact
                            className="mt-1"
                            value={customValues.villageName}
                            onChange={(val) => setCustomValues({ ...customValues, villageName: val })}
                            suggestions={villageOptions}
                            onAddNewVillage={(newVillage) =>
                              setCustomVillages((prev) => buildVillageSuggestions([...prev, newVillage]))
                            }
                            placeholder="Select or add village..."
                          />
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-emerald-300">{finalVillageName || '—'}</td>
                    </tr>

                    {/* Gender */}
                    <tr>
                      <td className="py-2.5 px-3 font-medium text-white">Gender</td>
                      <td className="py-2.5 px-3 text-slate-400">{selectedExistingMember?.gender ? GENDER_LABELS[selectedExistingMember.gender] : '—'}</td>
                      <td className="py-2.5 px-3 text-sky-300">{selectedRequest.gender ? GENDER_LABELS[selectedRequest.gender] : '—'}</td>
                      <td className="py-2.5 px-3">
                        <select
                          value={choices.gender}
                          onChange={(e) => setChoices({ ...choices, gender: e.target.value as MergeChoice })}
                          className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-2 py-1 text-white"
                        >
                          <option value="applicant">Applicant</option>
                          <option value="existing">Existing</option>
                          <option value="custom">Custom</option>
                        </select>
                        {choices.gender === 'custom' && (
                          <select
                            value={customValues.gender}
                            onChange={(e) => setCustomValues({ ...customValues, gender: e.target.value })}
                            className="mt-1 w-full bg-slate-900 border border-slate-700 text-xs rounded px-2 py-0.5 text-white"
                          >
                            <option value="">-- Choose --</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Other</option>
                            <option value="prefer_not_to_say">Prefer not to say</option>
                          </select>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-emerald-300">
                        {finalGender ? GENDER_LABELS[finalGender as Gender] : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-[11px] leading-relaxed">
              Approval links this verified Google account (UUID: <code className="font-mono text-emerald-200">{selectedRequest.user_id.slice(0, 8)}...</code>)
              to the selected member record, updates the reconciled fields above, and grants <strong>Member</strong> role access.
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsApproveModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-emerald-600/20 cursor-pointer flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isSubmitting
                    ? 'Approving & Linking...'
                    : approvalMode === 'create_new'
                    ? 'Create Member & Approve'
                    : 'Confirm Approval & Link'}
                </span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* RETURN FOR CORRECTION MODAL */}
      <ReasonModal
        isOpen={isReturnModalOpen}
        onClose={() => {
          setIsReturnModalOpen(false);
          setReturnTargetRequest(null);
        }}
        onConfirm={handleConfirmReturnForCorrection}
        title="Return Application for Correction"
        description="Please specify the exact corrections required (e.g. invalid date of birth, missing village locality, mismatch with existing records). The applicant will see this message upon their next login."
        confirmLabel="Return for Correction"
        isDestructive={false}
        isLoading={isSubmitting}
      />

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

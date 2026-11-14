import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Member, Gender, MembershipStatus } from '../../types/database';
import { GENDER_LABELS, validateNewChurchMember } from '../../lib/domain-logic';
import { ReasonModal, Modal } from '../common/Modals';
import {
  Users,
  Search,
  Plus,
  Edit,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Lock,
} from 'lucide-react';

export const MembersScreen: React.FC = () => {
  const { activeChurch, activeRole, isPlatformAdmin, churchAccessList } = useAuth();

  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [villageFilter, setVillageFilter] = useState('');

  // Selected Member for Edit
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Status Change State (Accountant Only!)
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [statusTargetMember, setStatusTargetMember] = useState<Member | null>(null);
  const [statusNewValue, setStatusNewValue] = useState<MembershipStatus>('inactive');
  const [isStatusLoading, setIsStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Form Fields
  const [fullName, setFullName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [villageName, setVillageName] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [joiningDate, setJoiningDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // PERMISSION CHECKS
  // Check if current user has an EXPLICIT 'accountant' role in this church
  const isExplicitChurchAccountant = churchAccessList.some(
    (a) => a.church_id === activeChurch?.id && a.role === 'accountant' && a.status === 'approved'
  );

  const canCreateMember = isPlatformAdmin || activeRole === 'admin' || activeRole === 'accountant';
  const canEditVillage = isPlatformAdmin || activeRole === 'admin' || activeRole === 'accountant';
  const canEditGender = isPlatformAdmin || activeRole === 'admin' || activeRole === 'accountant';

  const fetchMembers = async () => {
    if (!supabase || !activeChurch) return;
    setIsLoading(true);

    try {
      let query = supabase
        .from('members')
        .select('*')
        .eq('church_id', activeChurch.id)
        .order('full_name');

      if (statusFilter !== 'all') {
        query = query.eq('membership_status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setMembers((data || []) as Member[]);
    } catch (err) {
      console.error('Error fetching members:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [activeChurch, statusFilter]);

  // Handle Add Member Submit
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch) return;

    setFormError(null);
    setFieldErrors({});

    const validation = validateNewChurchMember({
      fullName,
      villageName,
      gender,
      contactPhone,
      contactEmail,
      dateOfBirth,
    });

    if (!validation.valid) {
      setFieldErrors(validation.errors);
      setFormError(Object.values(validation.errors)[0] || 'Please fill in all mandatory fields.');
      return;
    }

    setIsSaving(true);

    try {
      const memberNumber = `M-${String(members.length + 1).padStart(4, '0')}`;

      const { error } = await supabase.from('members').insert({
        church_id: activeChurch.id,
        member_number: memberNumber,
        full_name: validation.normalized.fullName,
        contact_phone: validation.normalized.contactPhone,
        contact_email: validation.normalized.contactEmail,
        village_name: validation.normalized.villageName,
        gender: validation.normalized.gender,
        date_of_birth: validation.normalized.dateOfBirth,
        joining_date: joiningDate,
        membership_status: 'active', // Server default
      }).select().single();

      if (error) throw error;

      setIsAddModalOpen(false);
      resetForm();
      await fetchMembers();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create member.');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle Edit Member Submit
  const handleEditMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !selectedMember) return;

    setIsSaving(true);
    setFormError(null);

    try {
      const updatePayload: Partial<Member> = {
        full_name: fullName.trim(),
        contact_phone: contactPhone.trim() || null,
        contact_email: contactEmail.trim() || null,
        date_of_birth: dateOfBirth || null,
      };

      if (canEditVillage) {
        updatePayload.village_name = villageName.trim() || null;
      }

      if (canEditGender) {
        updatePayload.gender = gender ? (gender as Gender) : null;
      }

      const { error } = await supabase
        .from('members')
        .update(updatePayload)
        .eq('id', selectedMember.id);

      if (error) throw error;

      setIsEditModalOpen(false);
      setSelectedMember(null);
      await fetchMembers();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to update member.');
    } finally {
      setIsSaving(false);
    }
  };

  // Open Edit Modal
  const openEditModal = (member: Member) => {
    setSelectedMember(member);
    setFullName(member.full_name);
    setContactPhone(member.contact_phone || '');
    setContactEmail(member.contact_email || '');
    setVillageName(member.village_name || '');
    setGender(member.gender || '');
    setDateOfBirth(member.date_of_birth || '');
    setJoiningDate(member.joining_date);
    setFormError(null);
    setIsEditModalOpen(true);
  };

  const resetForm = () => {
    setFullName('');
    setContactPhone('');
    setContactEmail('');
    setVillageName('');
    setGender('');
    setDateOfBirth('');
    setJoiningDate(new Date().toISOString().split('T')[0]);
    setFormError(null);
    setFieldErrors({});
  };

  // Open Status Change Reason Modal (ACCOUNTANT ONLY)
  const openStatusChangeModal = (member: Member) => {
    setStatusTargetMember(member);
    setStatusNewValue(member.membership_status === 'active' ? 'inactive' : 'active');
    setStatusError(null);
    setIsStatusModalOpen(true);
  };

  // Submit Status Change via change_member_status RPC
  const handleConfirmStatusChange = async (reason: string) => {
    if (!supabase || !statusTargetMember || !activeChurch) return;

    setIsStatusLoading(true);
    setStatusError(null);

    try {
      const { data, error } = await supabase.rpc('change_member_status', {
        p_church_id: activeChurch.id,
        p_member_id: statusTargetMember.id,
        p_new_status: statusNewValue,
        p_reason: reason,
      });

      if (error) throw error;

      setIsStatusModalOpen(false);
      setStatusTargetMember(null);
      await fetchMembers();
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setIsStatusLoading(false);
    }
  };

  // Filtered member list
  const filteredMembers = members.filter((m) => {
    if (searchQuery) {
      const term = searchQuery.toLowerCase();
      const matchName = m.full_name.toLowerCase().includes(term);
      const matchNum = m.member_number.toLowerCase().includes(term);
      const matchPhone = m.contact_phone && m.contact_phone.includes(term);
      const matchVillage = m.village_name && m.village_name.toLowerCase().includes(term);
      if (!matchName && !matchNum && !matchPhone && !matchVillage) return false;
    }
    if (villageFilter && (!m.village_name || !m.village_name.toLowerCase().includes(villageFilter.toLowerCase()))) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-400" />
            <span>Church Member Directory</span>
          </h1>
          <p className="text-xs text-slate-400">
            Official member roster for{' '}
            <strong className="text-slate-200">{activeChurch?.name}</strong>
          </p>
        </div>

        {canCreateMember && (
          <button
            onClick={() => {
              resetForm();
              setIsAddModalOpen(true);
            }}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Member</span>
          </button>
        )}
      </div>

      {/* Filters Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, number, phone..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Membership Statuses</option>
            <option value="active">Active Members Only</option>
            <option value="inactive">Inactive Members Only</option>
          </select>

          {/* Village Filter */}
          <div className="relative">
            <MapPin className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={villageFilter}
              onChange={(e) => setVillageFilter(e.target.value)}
              placeholder="Filter by village..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        {/* Status permission indicator */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
          <span>
            Showing <strong>{filteredMembers.length}</strong> of {members.length} members
          </span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            {isExplicitChurchAccountant ? (
              <span className="text-emerald-400">
                You are assigned as Accountant: Membership status toggles enabled
              </span>
            ) : (
              <span className="text-slate-400">
                Membership status changes strictly restricted to church Accountants
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                <th className="py-3 px-4 font-mono">Member #</th>
                <th className="py-3 px-4">Full Name</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Village / City</th>
                <th className="py-3 px-4">Gender</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Loading member roster...
                  </td>
                </tr>
              ) : filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No members found matching current filters.
                  </td>
                </tr>
              ) : (
                filteredMembers.map((m) => {
                  const isActive = m.membership_status === 'active';
                  return (
                    <tr key={m.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono font-medium text-sky-400">
                        {m.member_number}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">{m.full_name}</div>
                        {m.date_of_birth && (
                          <div className="text-[10px] font-mono text-slate-400">DOB: {m.date_of_birth}</div>
                        )}
                      </td>
                      <td className="py-3 px-4 space-y-0.5">
                        {m.contact_phone ? (
                          <div className="flex items-center gap-1 font-mono text-slate-300">
                            <Phone className="w-3 h-3 text-slate-500" />
                            <span>{m.contact_phone}</span>
                          </div>
                        ) : (
                          <span className="text-slate-600">No phone</span>
                        )}
                        {m.contact_email && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-400">
                            <Mail className="w-3 h-3 text-slate-500" />
                            <span>{m.contact_email}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {m.village_name ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-sky-400 shrink-0" />
                            <span>{m.village_name}</span>
                          </span>
                        ) : (
                          <span className="text-slate-600">&mdash;</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {m.gender ? GENDER_LABELS[m.gender] : <span className="text-slate-600">&mdash;</span>}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {/* Status Badge + Accountant-Only Action */}
                        <div className="inline-flex items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                              isActive
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}
                          >
                            {m.membership_status.toUpperCase()}
                          </span>

                          {/* STRICT: Only church Accountants see/can click status toggle */}
                          {isExplicitChurchAccountant && (
                            <button
                              onClick={() => openStatusChangeModal(m)}
                              title={`Change status to ${isActive ? 'Inactive' : 'Active'} (Reason required)`}
                              className="text-[10px] text-sky-400 hover:text-sky-300 underline font-medium ml-1"
                            >
                              Toggle
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => openEditModal(m)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ADD MEMBER MODAL (Admin & Accountant only; Collectors blocked) */}
      {isAddModalOpen && (
        <Modal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          title="Add New Church Member"
          maxWidth="md"
        >
          <form onSubmit={handleAddMember} className="space-y-4 text-xs">
            {formError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {formError}
              </div>
            )}

            <div>
              <label htmlFor="add-member-full-name" className="block text-slate-300 font-medium mb-1">
                Full Name <span className="text-red-400">*</span>
              </label>
              <input
                id="add-member-full-name"
                type="text"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (fieldErrors.fullName) setFieldErrors((prev) => ({ ...prev, fullName: '' }));
                }}
                required
                placeholder="e.g. Mary Joseph"
                className={`w-full bg-slate-950 border ${
                  fieldErrors.fullName ? 'border-red-500' : 'border-slate-700'
                } rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500`}
              />
              {fieldErrors.fullName && (
                <p className="text-[11px] text-red-400 mt-1">{fieldErrors.fullName}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Contact Phone</label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => {
                    setContactPhone(e.target.value);
                    if (fieldErrors.contactPhone) setFieldErrors((prev) => ({ ...prev, contactPhone: '' }));
                  }}
                  placeholder="+91 98400 00000"
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.contactPhone ? 'border-red-500' : 'border-slate-700'
                  } rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500 font-mono`}
                />
                {fieldErrors.contactPhone && (
                  <p className="text-[11px] text-red-400 mt-1">{fieldErrors.contactPhone}</p>
                )}
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Contact Email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => {
                    setContactEmail(e.target.value);
                    if (fieldErrors.contactEmail) setFieldErrors((prev) => ({ ...prev, contactEmail: '' }));
                  }}
                  placeholder="contact@example.com"
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.contactEmail ? 'border-red-500' : 'border-slate-700'
                  } rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500`}
                />
                {fieldErrors.contactEmail && (
                  <p className="text-[11px] text-red-400 mt-1">{fieldErrors.contactEmail}</p>
                )}
              </div>
            </div>

            {/* Village / City Name (Mandatory) */}
            <div>
              <label htmlFor="add-member-village" className="block text-slate-300 font-medium mb-1">
                Village / City Name <span className="text-red-400">*</span>
              </label>
              <input
                id="add-member-village"
                type="text"
                value={villageName}
                onChange={(e) => {
                  setVillageName(e.target.value);
                  if (fieldErrors.villageName) setFieldErrors((prev) => ({ ...prev, villageName: '' }));
                }}
                required
                placeholder="e.g. Tambaram, Kallakurichi, or Whitefield"
                className={`w-full bg-slate-950 border ${
                  fieldErrors.villageName ? 'border-red-500' : 'border-slate-700'
                } rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500`}
              />
              {fieldErrors.villageName && (
                <p className="text-[11px] text-red-400 mt-1">{fieldErrors.villageName}</p>
              )}
            </div>

            {/* Date of Birth & Gender */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Date of Birth <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="date"
                  value={dateOfBirth}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => {
                    setDateOfBirth(e.target.value);
                    if (fieldErrors.dateOfBirth) setFieldErrors((prev) => ({ ...prev, dateOfBirth: '' }));
                  }}
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.dateOfBirth ? 'border-red-500' : 'border-slate-700'
                  } rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500 font-mono`}
                />
                {fieldErrors.dateOfBirth && (
                  <p className="text-[11px] text-red-400 mt-1">{fieldErrors.dateOfBirth}</p>
                )}
              </div>

              <div>
                <label htmlFor="add-member-gender" className="block text-slate-300 font-medium mb-1">
                  Gender <span className="text-red-400">*</span>
                </label>
                <select
                  id="add-member-gender"
                  value={gender}
                  onChange={(e) => {
                    setGender(e.target.value as Gender | '');
                    if (fieldErrors.gender) setFieldErrors((prev) => ({ ...prev, gender: '' }));
                  }}
                  required
                  className={`w-full bg-slate-950 border ${
                    fieldErrors.gender ? 'border-red-500' : 'border-slate-700'
                  } rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500`}
                >
                  <option value="">-- Select Gender --</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
                {fieldErrors.gender && (
                  <p className="text-[11px] text-red-400 mt-1">{fieldErrors.gender}</p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Joining Date</label>
              <input
                type="date"
                value={joiningDate}
                onChange={(e) => setJoiningDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              New members receive a server-enforced initial status of <strong>Active</strong>.
              Only an authorized church Accountant can subsequently change membership status.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl transition-colors"
              >
                {isSaving ? 'Creating...' : 'Create Member'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* EDIT MEMBER MODAL */}
      {isEditModalOpen && selectedMember && (
        <Modal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title={`Edit Member: ${selectedMember.member_number}`}
          maxWidth="md"
        >
          <form onSubmit={handleEditMember} className="space-y-4 text-xs">
            {formError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {formError}
              </div>
            )}

            <div>
              <label className="block text-slate-300 font-medium mb-1">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Contact Phone</label>
                <input
                  type="tel"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Contact Email</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* Village / City Name: Admin and Accountant only; Collectors disabled */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Village / City Name {!canEditVillage && '(Read-only for Collectors)'}
              </label>
              <input
                type="text"
                value={villageName}
                onChange={(e) => setVillageName(e.target.value)}
                disabled={!canEditVillage}
                placeholder="e.g. Tambaram, Kallakurichi, or Whitefield"
                className="w-full bg-slate-950 border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Date of Birth & Gender in Edit Modal */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Date of Birth</label>
                <input
                  type="date"
                  value={dateOfBirth}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Gender {!canEditGender && '(Read-only for Collectors)'}
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender | '')}
                  disabled={!canEditGender}
                  className="w-full bg-slate-950 border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="">-- Not Provided (NULL) --</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ACCOUNTANT-ONLY MEMBERSHIP STATUS CHANGE REASON MODAL */}
      {statusTargetMember && (
        <ReasonModal
          isOpen={isStatusModalOpen}
          onClose={() => {
            setIsStatusModalOpen(false);
            setStatusTargetMember(null);
          }}
          onConfirm={handleConfirmStatusChange}
          title={`Change Membership Status to ${statusNewValue.toUpperCase()}`}
          description={`Strict specification rule: Only an assigned church Accountant may change member status. Marking a member Inactive does not cancel valid historical donations or delete ranking history. Reason is permanently logged in the audit trail.`}
          confirmLabel={`Mark as ${statusNewValue.toUpperCase()}`}
          isDestructive={statusNewValue === 'inactive'}
          isLoading={isStatusLoading}
        />
      )}
    </div>
  );
};

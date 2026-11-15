import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../types/database';
import {
  checkRolePermission,
  getAssignableStaffRoles,
  canManageStaffAssignmentStatus,
} from '../../lib/domain-logic';
import { Modal } from '../common/Modals';
import {
  UserCog,
  Plus,
  Shield,
  Users,
  Search,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Lock,
} from 'lucide-react';

interface StaffAssignmentItem {
  id: string;
  church_id: string;
  user_id: string;
  role: 'admin' | 'accountant' | 'collector';
  status: 'approved' | 'suspended';
  granted_at: string;
  granted_by: string | null;
  notes: string | null;
  profile: {
    id: string;
    email: string;
    full_name: string;
    phone: string | null;
  } | null;
  member: {
    id: string;
    member_number: string;
    full_name: string;
    village_name: string | null;
    contact_phone: string | null;
    membership_status: string;
  } | null;
}

interface EligibleMemberOption {
  member_id: string;
  member_number: string;
  full_name: string;
  village_name: string | null;
  contact_phone: string | null;
  membership_status: string;
  user_id: string;
  auth_email: string;
  collector_status: 'approved' | 'suspended' | null;
}

export const StaffManagementScreen: React.FC = () => {
  const { activeChurch, activeRole, isPlatformAdmin, refreshUserData } = useAuth();

  const [assignments, setAssignments] = useState<StaffAssignmentItem[]>([]);
  const [eligibleMembers, setEligibleMembers] = useState<EligibleMemberOption[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadNotice, setLoadNotice] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectionSource, setSelectionSource] = useState<'member' | 'profile'>('member');
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'admin' | 'accountant' | 'collector'>('collector');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isAdminOrPlatform = isPlatformAdmin || activeRole === 'admin';
  const isAccountantOnly = !isAdminOrPlatform && activeRole === 'accountant';
  const assignableRoles = getAssignableStaffRoles(activeRole, isPlatformAdmin);
  const canManageStaff = checkRolePermission(
    isPlatformAdmin ? 'platform_admin' : activeRole,
    'assign_collector_role'
  ).allowed;

  const isPreviewMode =
    typeof window !== 'undefined' &&
    (!supabase || Boolean(window.sessionStorage.getItem('cms_preview_persona')));

  const fetchStaffData = async () => {
    if (!activeChurch) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadNotice(null);

    if (isPreviewMode) {
      const storageKey = `cms_preview_staff_${activeChurch.id}`;
      const defaultAssignments: StaffAssignmentItem[] = [
        {
          id: 'acc-preview-1',
          church_id: activeChurch.id,
          user_id: 'u-accountant-001',
          role: 'accountant',
          status: 'approved',
          granted_at: new Date().toISOString(),
          granted_by: 'u-admin-003',
          notes: 'Assigned Church Accountant',
          profile: {
            id: 'u-accountant-001',
            email: 'accountant@bethel.org',
            full_name: 'Grace Thomas',
            phone: '9840000001',
          },
          member: null,
        },
        {
          id: 'acc-preview-col-1',
          church_id: activeChurch.id,
          user_id: 'u-member-002',
          role: 'collector',
          status: 'approved',
          granted_at: new Date().toISOString(),
          granted_by: 'u-accountant-001',
          notes: 'Sunday service offering collector',
          profile: {
            id: 'u-member-002',
            email: 'member@bethel.org',
            full_name: 'David Paul',
            phone: '9840000002',
          },
          member: {
            id: 'mem-preview-1',
            member_number: 'M-0042',
            full_name: 'David Paul',
            village_name: 'Tambaram',
            contact_phone: '9840000002',
            membership_status: 'active',
          },
        },
      ];

      let loadedAssignments = defaultAssignments;
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as StaffAssignmentItem[];
          if (Array.isArray(parsed)) loadedAssignments = parsed;
        }
      } catch {
        // ignore
      }

      const collectorStatusMap = new Map<string, 'approved' | 'suspended'>();
      for (const item of loadedAssignments) {
        if (item.role === 'collector') {
          collectorStatusMap.set(item.user_id, item.status);
        }
      }

      const sampleEligibleMembers: EligibleMemberOption[] = [
        {
          member_id: 'mem-preview-1',
          member_number: 'M-0042',
          full_name: 'David Paul',
          village_name: 'Tambaram',
          contact_phone: '9840000002',
          membership_status: 'active',
          user_id: 'u-member-002',
          auth_email: 'member@bethel.org',
          collector_status: collectorStatusMap.get('u-member-002') || null,
        },
        {
          member_id: 'mem-preview-2',
          member_number: 'M-0043',
          full_name: 'Samuel Rajan',
          village_name: 'Kallakurichi',
          contact_phone: '9840123456',
          membership_status: 'active',
          user_id: 'u-member-004',
          auth_email: 'samuel.rajan@gmail.com',
          collector_status: collectorStatusMap.get('u-member-004') || null,
        },
        {
          member_id: 'mem-preview-3',
          member_number: 'M-0044',
          full_name: 'Rebecca Joseph',
          village_name: 'Guindy',
          contact_phone: '9884012345',
          membership_status: 'active',
          user_id: 'u-member-005',
          auth_email: 'rebecca.joseph@gmail.com',
          collector_status: collectorStatusMap.get('u-member-005') || null,
        },
      ];

      setAssignments(loadedAssignments);
      setEligibleMembers(sampleEligibleMembers);
      setProfiles(
        isAdminOrPlatform
          ? sampleEligibleMembers.map((m) => ({
              id: m.user_id,
              email: m.auth_email,
              full_name: m.full_name,
              phone: m.contact_phone,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }))
          : []
      );
      setIsLoading(false);
      return;
    }

    if (!supabase) {
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_church_staff_management_data', {
        p_church_id: activeChurch.id,
      });

      if (error) {
        // Graceful fallback for Admins if migration hasn't been applied yet
        if (isAdminOrPlatform) {
          const { data: fallbackAssignments } = await supabase
            .from('church_access')
            .select('*, profile:profiles(*)')
            .eq('church_id', activeChurch.id)
            .in('role', ['admin', 'accountant', 'collector']);

          if (fallbackAssignments) {
            setAssignments(
              (fallbackAssignments as Array<Record<string, unknown>>).map((row) => ({
                id: String(row.id),
                church_id: String(row.church_id),
                user_id: String(row.user_id),
                role: row.role as 'admin' | 'accountant' | 'collector',
                status: row.status as 'approved' | 'suspended',
                granted_at: String(row.granted_at || ''),
                granted_by: row.granted_by ? String(row.granted_by) : null,
                notes: row.notes ? String(row.notes) : null,
                profile: (row.profile as StaffAssignmentItem['profile']) || null,
                member: null,
              }))
            );
          }

          const { data: profs } = await supabase.from('profiles').select('*').order('full_name');
          if (profs) setProfiles(profs as Profile[]);
        }
        setLoadNotice(
          'Apply migration 20261115000001_accountant_collector_staff_management.sql in Supabase to enable church-member collector assignment.'
        );
        return;
      }

      const payload = data as {
        assignments?: StaffAssignmentItem[];
        eligible_members?: EligibleMemberOption[];
        profiles?: Profile[];
      } | null;

      setAssignments(payload?.assignments || []);
      setEligibleMembers(payload?.eligible_members || []);
      setProfiles(payload?.profiles || []);
    } catch (err) {
      console.error('Error fetching staff management data:', err);
      setLoadNotice(err instanceof Error ? err.message : 'Unable to load staff access data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStaffData();
  }, [activeChurch, activeRole, isPlatformAdmin]);

  const filteredEligibleMembers = useMemo(() => {
    const term = memberSearch.trim().toLowerCase();
    if (!term) return eligibleMembers;
    return eligibleMembers.filter(
      (m) =>
        m.full_name.toLowerCase().includes(term) ||
        m.member_number.toLowerCase().includes(term) ||
        (m.village_name && m.village_name.toLowerCase().includes(term)) ||
        m.auth_email.toLowerCase().includes(term)
    );
  }, [eligibleMembers, memberSearch]);

  const openAssignModal = () => {
    setErrorMsg(null);
    setMemberSearch('');
    setSelectedUserId('');
    setSelectedRole('collector');
    setSelectionSource('member');
    setNotes('');
    setIsModalOpen(true);
  };

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChurch || !selectedUserId) return;

    const effectiveRole: 'admin' | 'accountant' | 'collector' = isAccountantOnly
      ? 'collector'
      : selectedRole;

    setIsSubmitting(true);
    setErrorMsg(null);
    setActionSuccess(null);

    try {
      if (isPreviewMode) {
        const storageKey = `cms_preview_staff_${activeChurch.id}`;
        const memberMatch = eligibleMembers.find((m) => m.user_id === selectedUserId);
        const profileMatch = profiles.find((p) => p.id === selectedUserId);

        const nextItem: StaffAssignmentItem = {
          id: `acc-preview-${selectedUserId}-${effectiveRole}`,
          church_id: activeChurch.id,
          user_id: selectedUserId,
          role: effectiveRole,
          status: 'approved',
          granted_at: new Date().toISOString(),
          granted_by: 'preview-actor',
          notes: notes.trim() || null,
          profile: {
            id: selectedUserId,
            email: memberMatch?.auth_email || profileMatch?.email || '',
            full_name: memberMatch?.full_name || profileMatch?.full_name || 'Church Member',
            phone: memberMatch?.contact_phone || profileMatch?.phone || null,
          },
          member: memberMatch
            ? {
                id: memberMatch.member_id,
                member_number: memberMatch.member_number,
                full_name: memberMatch.full_name,
                village_name: memberMatch.village_name,
                contact_phone: memberMatch.contact_phone,
                membership_status: memberMatch.membership_status,
              }
            : null,
        };

        const updated = [
          ...assignments.filter(
            (a) => !(a.user_id === selectedUserId && a.role === effectiveRole)
          ),
          nextItem,
        ];
        window.localStorage.setItem(storageKey, JSON.stringify(updated));
        setIsModalOpen(false);
        setActionSuccess(
          `Assigned ${effectiveRole.toUpperCase()} access to ${nextItem.profile?.full_name || 'member'}.`
        );
        await fetchStaffData();
        return;
      }

      if (!supabase) {
        throw new Error('Database connection unavailable.');
      }

      const { error } = await supabase.rpc('assign_church_staff_role', {
        p_church_id: activeChurch.id,
        p_user_id: selectedUserId,
        p_role: effectiveRole,
        p_notes: notes.trim() || null,
      });

      if (error) throw error;

      setIsModalOpen(false);
      setNotes('');
      setSelectedUserId('');
      setActionSuccess(`Successfully granted ${effectiveRole.toUpperCase()} access.`);
      await Promise.all([fetchStaffData(), refreshUserData()]);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to assign staff role.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleSuspension = async (item: StaffAssignmentItem) => {
    if (!activeChurch) return;
    if (!canManageStaffAssignmentStatus(activeRole, item.role, isPlatformAdmin)) {
      return;
    }

    const newStatus = item.status === 'approved' ? 'suspended' : 'approved';
    setTogglingId(item.id);
    setActionSuccess(null);
    setLoadNotice(null);

    try {
      if (isPreviewMode) {
        const storageKey = `cms_preview_staff_${activeChurch.id}`;
        const updated = assignments.map((a) =>
          a.id === item.id ? { ...a, status: newStatus as 'approved' | 'suspended' } : a
        );
        window.localStorage.setItem(storageKey, JSON.stringify(updated));
        setActionSuccess(
          `${item.profile?.full_name || 'Staff member'} (${item.role}) is now ${newStatus.toUpperCase()}.`
        );
        await fetchStaffData();
        return;
      }

      if (!supabase) {
        throw new Error('Database connection unavailable.');
      }

      const { error } = await supabase.rpc('toggle_church_staff_status', {
        p_church_id: activeChurch.id,
        p_assignment_id: item.id,
        p_new_status: newStatus,
      });

      if (error) throw error;

      setActionSuccess(
        `Updated ${item.profile?.full_name || 'staff'} (${item.role}) access to ${newStatus.toUpperCase()}.`
      );
      await Promise.all([fetchStaffData(), refreshUserData()]);
    } catch (err: unknown) {
      setLoadNotice(err instanceof Error ? err.message : 'Failed to update staff status.');
    } finally {
      setTogglingId(null);
    }
  };

  if (!canManageStaff) {
    return (
      <div className="max-w-xl mx-auto bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-2">
        <Lock className="w-8 h-8 text-amber-400 mx-auto" />
        <h2 className="text-sm font-semibold text-white">Staff Access Management Restricted</h2>
        <p className="text-xs text-slate-400">
          Only Church Admins and Accountants can manage church staff and collector access.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <UserCog className="w-5 h-5 text-sky-400" />
            <span>{isAccountantOnly ? 'Staff Access & Collector Assignment' : 'Staff Roles & Permissions'}</span>
          </h1>
          <p className="text-xs text-slate-400">
            {isAccountantOnly ? (
              <>
                Assign and manage <strong className="text-slate-200">Collector</strong> access from
                active church members in <strong className="text-slate-200">{activeChurch?.name}</strong>
              </>
            ) : (
              <>
                Staff role and collector access management for{' '}
                <strong className="text-slate-200">{activeChurch?.name}</strong>
              </>
            )}
          </p>
        </div>

        <button
          onClick={openAssignModal}
          className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>{isAccountantOnly ? 'Assign Collector' : 'Assign Staff Role'}</span>
        </button>
      </div>

      {/* Role Scope Info Card for Accountants */}
      {isAccountantOnly && (
        <div className="bg-sky-950/30 border border-sky-500/20 rounded-2xl p-4 text-xs text-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Shield className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <strong className="text-white block">Accountant Collector Authority</strong>
              <span className="text-[11px] text-slate-400">
                You can promote any active, verified member of {activeChurch?.name} to{' '}
                <strong className="text-sky-300">Collector</strong> (allows recording donations) and
                suspend or restore Collector access. Admin &amp; Accountant roles remain managed by Church Admins.
              </span>
            </div>
          </div>
          <div className="shrink-0 text-[11px] font-mono bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-xl text-sky-300">
            {eligibleMembers.length} Eligible Linked {eligibleMembers.length === 1 ? 'Member' : 'Members'}
          </div>
        </div>
      )}

      {actionSuccess && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {loadNotice && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-200 rounded-xl text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{loadNotice}</span>
        </div>
      )}

      {/* Staff Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Authentication Email</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Notes</th>
                <th className="py-3 px-4 text-center">Access Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading staff assignments...
                  </td>
                </tr>
              ) : assignments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No staff roles assigned yet for {activeChurch?.name}.
                  </td>
                </tr>
              ) : (
                assignments.map((item) => {
                  const canToggle = canManageStaffAssignmentStatus(
                    activeRole,
                    item.role,
                    isPlatformAdmin
                  );
                  return (
                    <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">
                          {item.member?.full_name || item.profile?.full_name || 'User'}
                        </div>
                        {item.member && (
                          <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5 font-mono">
                            <span className="text-sky-400">{item.member.member_number}</span>
                            {item.member.village_name && (
                              <span className="inline-flex items-center gap-0.5 text-slate-400 font-sans">
                                &bull; <MapPin className="w-2.5 h-2.5" /> {item.member.village_name}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {item.profile?.email || 'N/A'}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono font-semibold border ${
                            item.role === 'admin'
                              ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                              : item.role === 'accountant'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                          }`}
                        >
                          {item.role}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 max-w-[200px] truncate">
                        {item.notes || <span className="text-slate-600">&mdash;</span>}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                            item.status === 'approved'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              : 'bg-red-500/15 text-red-300 border-red-500/30'
                          }`}
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {canToggle ? (
                          <button
                            onClick={() => handleToggleSuspension(item)}
                            disabled={togglingId === item.id}
                            className={`text-xs underline font-medium cursor-pointer disabled:opacity-50 ${
                              item.status === 'approved'
                                ? 'text-amber-400 hover:text-amber-300'
                                : 'text-emerald-400 hover:text-emerald-300'
                            }`}
                          >
                            {togglingId === item.id
                              ? 'Updating...'
                              : item.status === 'approved'
                              ? 'Suspend Access'
                              : 'Restore Access'}
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-500">Admin managed</span>
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

      {/* Assign Modal */}
      {isModalOpen && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={
            isAccountantOnly
              ? 'Assign Collector from Church Members'
              : 'Assign Church Staff Role'
          }
          maxWidth="md"
        >
          <form onSubmit={handleCreateAssignment} className="space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {errorMsg}
              </div>
            )}

            {/* Admins can choose between Church Members and All Registered Accounts */}
            {isAdminOrPlatform && (
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">
                  Select User Source
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionSource('member');
                      setSelectedUserId('');
                    }}
                    className={`px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
                      selectionSource === 'member'
                        ? 'bg-sky-500/15 border-sky-500/40 text-sky-200 font-semibold'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5 inline mr-1.5" />
                    Church Members ({eligibleMembers.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectionSource('profile');
                      setSelectedUserId('');
                    }}
                    className={`px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
                      selectionSource === 'profile'
                        ? 'bg-sky-500/15 border-sky-500/40 text-sky-200 font-semibold'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <UserCog className="w-3.5 h-3.5 inline mr-1.5" />
                    All Accounts ({profiles.length})
                  </button>
                </div>
              </div>
            )}

            {selectionSource === 'member' || isAccountantOnly ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="assign-member-select" className="block text-slate-300 font-medium">
                    Church Member ({activeChurch?.name}) <span className="text-red-400">*</span>
                  </label>
                  <span className="text-[10px] text-slate-500 font-mono">
                    Active linked members only
                  </span>
                </div>

                {eligibleMembers.length > 4 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Filter members by name, member #, village, or email..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                )}

                <select
                  id="assign-member-select"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="">-- Select a Verified Church Member --</option>
                  {filteredEligibleMembers.map((m) => (
                    <option key={m.member_id} value={m.user_id}>
                      {m.member_number} &bull; {m.full_name}
                      {m.village_name ? ` (${m.village_name})` : ''} &mdash; {m.auth_email}
                      {m.collector_status === 'approved'
                        ? ' [Already Collector]'
                        : m.collector_status === 'suspended'
                        ? ' [Suspended Collector]'
                        : ''}
                    </option>
                  ))}
                </select>

                {eligibleMembers.length === 0 && (
                  <p className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
                    No active linked church members found yet. Members must sign in with Google and
                    be approved under <strong>Access Approvals</strong> before they can be assigned
                    as a Collector.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label htmlFor="assign-profile-select" className="block text-slate-300 font-medium mb-1">
                  User Account <span className="text-red-400">*</span>
                </label>
                <select
                  id="assign-profile-select"
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-sky-500"
                >
                  <option value="">-- Choose User --</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.email})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="assign-role-select" className="block text-slate-300 font-medium mb-1">
                Role Assignment <span className="text-red-400">*</span>
              </label>
              <select
                id="assign-role-select"
                value={isAccountantOnly ? 'collector' : selectedRole}
                onChange={(e) =>
                  setSelectedRole(e.target.value as 'admin' | 'accountant' | 'collector')
                }
                disabled={isAccountantOnly}
                required
                className="w-full bg-slate-950 border border-slate-700 disabled:opacity-80 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-sky-500"
              >
                {assignableRoles.includes('collector') && (
                  <option value="collector">Collector (Records donations only)</option>
                )}
                {assignableRoles.includes('accountant') && (
                  <option value="accountant">
                    Accountant (Maintains members, approvals, collectors, reports)
                  </option>
                )}
                {assignableRoles.includes('admin') && (
                  <option value="admin">Church Admin (Manages church staff &amp; settings)</option>
                )}
              </select>
              {isAccountantOnly && (
                <p className="text-[10px] text-slate-500 mt-1">
                  Accountants can assign the Collector role to active members of their church.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="assign-notes-input" className="block text-slate-300 font-medium mb-1">
                Assignment Notes <span className="text-slate-500 font-normal">(Optional)</span>
              </label>
              <input
                id="assign-notes-input"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Zone 2 Sunday collector"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !selectedUserId}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors cursor-pointer"
              >
                {isSubmitting
                  ? 'Assigning...'
                  : isAccountantOnly
                  ? 'Assign Collector'
                  : 'Grant Role'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { ChurchAccess, Profile } from '../../types/database';
import { Modal } from '../common/Modals';
import { UserCog, Plus, Shield, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export const StaffManagementScreen: React.FC = () => {
  const { activeChurch } = useAuth();

  const [assignments, setAssignments] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'admin' | 'accountant' | 'collector'>('collector');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchAssignments = async () => {
    if (!supabase || !activeChurch) return;

    try {
      const { data } = await supabase
        .from('church_access')
        .select('*, profile:profiles(*)')
        .eq('church_id', activeChurch.id);

      if (data) setAssignments(data);

      const { data: profs } = await supabase.from('profiles').select('*').order('full_name');
      if (profs) setProfiles(profs as Profile[]);
    } catch (err) {
      console.error('Error fetching staff assignments:', err);
    }
  };

  useEffect(() => {
    fetchAssignments();
  }, [activeChurch]);

  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch || !selectedUserId) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from('church_access').upsert({
        church_id: activeChurch.id,
        user_id: selectedUserId,
        role: selectedRole,
        status: 'approved',
        notes: notes.trim() || null,
      });

      if (error) throw error;

      setIsModalOpen(false);
      setNotes('');
      await fetchAssignments();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to assign role.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleSuspension = async (assignmentId: string, currentStatus: string) => {
    if (!supabase) return;
    const newStatus = currentStatus === 'approved' ? 'suspended' : 'approved';
    await supabase.from('church_access').update({ status: newStatus }).eq('id', assignmentId);
    await fetchAssignments();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <UserCog className="w-5 h-5 text-sky-400" />
            <span>Staff Roles &amp; Permissions</span>
          </h1>
          <p className="text-xs text-slate-400">
            Admin access management for <strong className="text-slate-200">{activeChurch?.name}</strong>
          </p>
        </div>

        <button
          onClick={() => {
            setErrorMsg(null);
            setIsModalOpen(true);
          }}
          className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Assign Staff Role</span>
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
              <th className="py-2.5 px-4">Staff Member</th>
              <th className="py-2.5 px-4">Email</th>
              <th className="py-2.5 px-4">Role</th>
              <th className="py-2.5 px-4 text-center">Access Status</th>
              <th className="py-2.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {assignments.map((item) => (
              <tr key={item.id} className="hover:bg-slate-800/40">
                <td className="py-2.5 px-4 font-semibold text-white">
                  {item.profile?.full_name || 'User'}
                </td>
                <td className="py-2.5 px-4 font-mono text-slate-400">
                  {item.profile?.email || 'N/A'}
                </td>
                <td className="py-2.5 px-4 uppercase font-mono font-semibold text-sky-300">
                  {item.role}
                </td>
                <td className="py-2.5 px-4 text-center">
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
                <td className="py-2.5 px-4 text-right">
                  <button
                    onClick={() => handleToggleSuspension(item.id, item.status)}
                    className="text-xs text-sky-400 hover:text-sky-300 underline font-medium"
                  >
                    {item.status === 'approved' ? 'Suspend Access' : 'Restore Access'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Assign Staff Role"
          maxWidth="sm"
        >
          <form onSubmit={handleCreateAssignment} className="space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {errorMsg}
              </div>
            )}
            <div>
              <label className="block text-slate-300 font-medium mb-1">User Account</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">-- Choose User --</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.email})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Role Assignment</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as any)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              >
                <option value="collector">Collector (Records donations only)</option>
                <option value="accountant">Accountant (Maintains members, status, reports)</option>
                <option value="admin">Church Admin (Manages church staff &amp; settings)</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg"
              >
                {isSubmitting ? 'Saving...' : 'Grant Role'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

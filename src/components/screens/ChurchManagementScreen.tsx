import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Church } from '../../types/database';
import { Modal } from '../common/Modals';
import { Building2, Plus, Phone, Mail, MapPin, CheckCircle, Hash } from 'lucide-react';

export const ChurchManagementScreen: React.FC = () => {
  const { authorizedChurches, refreshUserData } = useAuth();

  const [churches, setChurches] = useState<Church[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [receiptPrefix, setReceiptPrefix] = useState('REC/2026-27/');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchChurches = async () => {
    if (!supabase) return;
    const { data } = await supabase.from('churches').select('*').order('name');
    if (data) setChurches(data as Church[]);
  };

  useEffect(() => {
    fetchChurches();
  }, []);

  const handleCreateChurch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const { data, error } = await supabase.from('churches').insert({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        address: address.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        receipt_prefix: receiptPrefix.trim() || 'REC/2026-27/',
        is_active: true,
      }).select().single();

      if (error) throw error;

      setIsModalOpen(false);
      setCode('');
      setName('');
      setAddress('');
      setPhone('');
      setEmail('');
      await fetchChurches();
      await refreshUserData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create church.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Building2 className="w-5 h-5 text-sky-400" />
            <span>Multi-Church Administration</span>
          </h1>
          <p className="text-xs text-slate-400">
            Create and maintain isolated churches on the platform
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
          <span>Add Church</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {churches.map((church) => (
          <div
            key={church.id}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[11px] font-mono text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20 uppercase font-semibold">
                  Code: {church.code}
                </span>
                <h3 className="text-base font-bold text-white mt-1.5">{church.name}</h3>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                  church.is_active
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {church.is_active ? 'ACTIVE' : 'INACTIVE'}
              </span>
            </div>

            <div className="space-y-1 text-xs text-slate-400 pt-1 border-t border-slate-800/80">
              {church.address && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{church.address}</span>
                </div>
              )}
              {church.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="font-mono">{church.phone}</span>
                </div>
              )}
              {church.email && (
                <div className="flex items-center gap-2">
                  <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{church.email}</span>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500">Receipt Prefix:</span>
              <span className="text-sky-300 font-semibold">{church.receipt_prefix}</span>
            </div>
          </div>
        ))}
      </div>

      {/* CREATE CHURCH MODAL */}
      {isModalOpen && (
        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title="Create New Church"
          maxWidth="md"
        >
          <form onSubmit={handleCreateChurch} className="space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {errorMsg}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Church Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Grace Bethel Church"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Unique Church Code</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  placeholder="e.g. GBC-CHN"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono uppercase focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Church street address, city, pin code"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98400 00000"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="office@church.org"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Default Receipt Prefix</label>
              <input
                type="text"
                value={receiptPrefix}
                onChange={(e) => setReceiptPrefix(e.target.value)}
                placeholder="e.g. GBC/2026-27/"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-sky-500"
              />
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
                {isSubmitting ? 'Creating...' : 'Create Church'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

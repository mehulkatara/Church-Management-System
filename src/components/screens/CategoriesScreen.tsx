import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { DonationCategory, ReceivingAccount, AccountType } from '../../types/database';
import { Modal } from '../common/Modals';
import { FolderTree, Plus, Landmark, Banknote, CheckCircle, XCircle } from 'lucide-react';

export const CategoriesScreen: React.FC = () => {
  const { activeChurch } = useAuth();

  const [categories, setCategories] = useState<DonationCategory[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Category Modal
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [catName, setCatName] = useState('');
  const [catCode, setCatCode] = useState('');

  // Account Modal
  const [isAccModalOpen, setIsAccModalOpen] = useState(false);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('cash');
  const [bankName, setBankName] = useState('');
  const [accountNumberMask, setAccountNumberMask] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchData = async () => {
    if (!supabase || !activeChurch) return;
    setIsLoading(true);

    try {
      const { data: catData } = await supabase
        .from('donation_categories')
        .select('*')
        .eq('church_id', activeChurch.id)
        .order('name');
      if (catData) setCategories(catData as DonationCategory[]);

      const { data: accData } = await supabase
        .from('receiving_accounts')
        .select('*')
        .eq('church_id', activeChurch.id)
        .order('account_name');
      if (accData) setAccounts(accData as ReceivingAccount[]);
    } catch (err) {
      console.error('Error fetching categories & accounts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeChurch]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const code = catCode.trim().toUpperCase() || catName.trim().toUpperCase().replace(/\s+/g, '_');
      const { error } = await supabase.from('donation_categories').insert({
        church_id: activeChurch.id,
        name: catName.trim(),
        code,
        is_active: true,
      });

      if (error) throw error;

      setIsCatModalOpen(false);
      setCatName('');
      setCatCode('');
      await fetchData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add category.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch) return;
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from('receiving_accounts').insert({
        church_id: activeChurch.id,
        account_name: accName.trim(),
        account_type: accType,
        bank_name: accType === 'bank' ? bankName.trim() : null,
        account_number_mask: accType === 'bank' ? accountNumberMask.trim() : null,
        is_active: true,
      });

      if (error) throw error;

      setIsAccModalOpen(false);
      setAccName('');
      setBankName('');
      setAccountNumberMask('');
      await fetchData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleCategoryStatus = async (category: DonationCategory) => {
    if (!supabase) return;
    await supabase
      .from('donation_categories')
      .update({ is_active: !category.is_active })
      .eq('id', category.id);
    await fetchData();
  };

  const toggleAccountStatus = async (account: ReceivingAccount) => {
    if (!supabase) return;
    await supabase
      .from('receiving_accounts')
      .update({ is_active: !account.is_active })
      .eq('id', account.id);
    await fetchData();
  };

  return (
    <div className="space-y-8">
      {/* 1. DONATION CATEGORIES */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <FolderTree className="w-5 h-5 text-sky-400" />
              <span>Donation Categories</span>
            </h2>
            <p className="text-xs text-slate-400">
              Only active categories can be chosen for new donations. Deactivation preserves historical references.
            </p>
          </div>

          <button
            onClick={() => {
              setErrorMsg(null);
              setIsCatModalOpen(true);
            }}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Category</span>
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                <th className="py-2.5 px-4">Category Name</th>
                <th className="py-2.5 px-4 font-mono">Code</th>
                <th className="py-2.5 px-4 text-center">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {categories.map((c) => (
                <tr key={c.id} className="hover:bg-slate-800/40">
                  <td className="py-2.5 px-4 font-semibold text-white">{c.name}</td>
                  <td className="py-2.5 px-4 font-mono text-sky-400">{c.code}</td>
                  <td className="py-2.5 px-4 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                        c.is_active
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {c.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      onClick={() => toggleCategoryStatus(c)}
                      className="text-xs text-sky-400 hover:text-sky-300 underline font-medium"
                    >
                      {c.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. RECEIVING ACCOUNTS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <Landmark className="w-5 h-5 text-emerald-400" />
              <span>Receiving Accounts (Cash &amp; Bank)</span>
            </h2>
            <p className="text-xs text-slate-400">
              Accounts that receive and hold donations for {activeChurch?.name}.
            </p>
          </div>

          <button
            onClick={() => {
              setErrorMsg(null);
              setIsAccModalOpen(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-emerald-600/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Account</span>
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                <th className="py-2.5 px-4">Account Name</th>
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-4">Bank / Mask</th>
                <th className="py-2.5 px-4 text-center">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {accounts.map((a) => (
                <tr key={a.id} className="hover:bg-slate-800/40">
                  <td className="py-2.5 px-4 font-semibold text-white">{a.account_name}</td>
                  <td className="py-2.5 px-4 uppercase font-mono text-slate-400">{a.account_type}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-300">
                    {a.bank_name ? `${a.bank_name} (${a.account_number_mask || '••••'})` : 'Cash Box'}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                        a.is_active
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {a.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      onClick={() => toggleAccountStatus(a)}
                      className="text-xs text-sky-400 hover:text-sky-300 underline font-medium"
                    >
                      {a.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE CATEGORY MODAL */}
      {isCatModalOpen && (
        <Modal
          isOpen={isCatModalOpen}
          onClose={() => setIsCatModalOpen(false)}
          title="Add Donation Category"
          maxWidth="sm"
        >
          <form onSubmit={handleCreateCategory} className="space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {errorMsg}
              </div>
            )}
            <div>
              <label className="block text-slate-300 font-medium mb-1">Category Name</label>
              <input
                type="text"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                required
                placeholder="e.g. Building Fund"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Category Code <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                value={catCode}
                onChange={(e) => setCatCode(e.target.value)}
                placeholder="e.g. BLDG_FUND"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono uppercase focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsCatModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg"
              >
                {isSubmitting ? 'Saving...' : 'Add Category'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* CREATE ACCOUNT MODAL */}
      {isAccModalOpen && (
        <Modal
          isOpen={isAccModalOpen}
          onClose={() => setIsAccModalOpen(false)}
          title="Add Receiving Account"
          maxWidth="sm"
        >
          <form onSubmit={handleCreateAccount} className="space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {errorMsg}
              </div>
            )}
            <div>
              <label className="block text-slate-300 font-medium mb-1">Account Name</label>
              <input
                type="text"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                required
                placeholder="e.g. SBI Main Account or Cash Box"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">Account Type</label>
              <select
                value={accType}
                onChange={(e) => setAccType(e.target.value as AccountType)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              >
                <option value="cash">Cash Box</option>
                <option value="bank">Bank Account</option>
              </select>
            </div>
            {accType === 'bank' && (
              <>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. State Bank of India"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Account Number Mask</label>
                  <input
                    type="text"
                    value={accountNumberMask}
                    onChange={(e) => setAccountNumberMask(e.target.value)}
                    placeholder="e.g. •••• 8912"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
              </>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAccModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg"
              >
                {isSubmitting ? 'Saving...' : 'Add Account'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

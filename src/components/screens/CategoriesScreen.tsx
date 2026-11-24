import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type {
  DonationCategory,
  ExpenseCategory,
  ReceivingAccount,
  AccountType,
} from '../../types/database';
import { Modal } from '../common/Modals';
import { FolderTree, Plus, Landmark, Wallet } from 'lucide-react';

export const CategoriesScreen: React.FC = () => {
  const { activeChurch } = useAuth();

  const [categories, setCategories] = useState<DonationCategory[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Donation Category Modal
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [catName, setCatName] = useState('');

  // Expense Category Modal
  const [isExpCatModalOpen, setIsExpCatModalOpen] = useState(false);
  const [expCatName, setExpCatName] = useState('');

  // Account Modal
  const [isAccModalOpen, setIsAccModalOpen] = useState(false);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('cash');
  const [bankName, setBankName] = useState('');
  const [accountNumberMask, setAccountNumberMask] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchData = async () => {
    if (!supabase || !activeChurch) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    try {
      const [{ data: catData }, { data: expCatData }, { data: accData }] = await Promise.all([
        supabase
          .from('donation_categories')
          .select('*')
          .eq('church_id', activeChurch.id)
          .order('name'),
        supabase
          .from('expense_categories')
          .select('*')
          .eq('church_id', activeChurch.id)
          .order('name'),
        supabase
          .from('receiving_accounts')
          .select('*')
          .eq('church_id', activeChurch.id)
          .order('account_name'),
      ]);

      setCategories((catData || []) as DonationCategory[]);
      setExpenseCategories((expCatData || []) as ExpenseCategory[]);
      setAccounts((accData || []) as ReceivingAccount[]);
    } catch (err) {
      console.error('Error fetching categories & accounts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [activeChurch]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch) return;
    const trimmed = catName.trim();
    if (!trimmed) {
      setErrorMsg('Category name is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from('donation_categories').insert({
        church_id: activeChurch.id,
        name: trimmed,
        is_active: true,
      });

      if (error) throw error;

      setIsCatModalOpen(false);
      setCatName('');
      await fetchData();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add category.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateExpenseCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch) return;
    const trimmed = expCatName.trim();
    if (!trimmed) {
      setErrorMsg('Expense category name is required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from('expense_categories').insert({
        church_id: activeChurch.id,
        name: trimmed,
        is_active: true,
      });

      if (error) throw error;

      setIsExpCatModalOpen(false);
      setExpCatName('');
      await fetchData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === 'object' && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Failed to add expense category.';
      if (msg.includes('uq_expense_categories_church_name') || msg.toLowerCase().includes('duplicate')) {
        setErrorMsg(`An expense category named "${trimmed}" already exists for this church.`);
      } else {
        setErrorMsg(msg);
      }
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

  const toggleExpenseCategoryStatus = async (category: ExpenseCategory) => {
    if (!supabase) return;
    await supabase
      .from('expense_categories')
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <FolderTree className="w-5 h-5 text-sky-400" />
              <span>Donation Categories</span>
            </h2>
            <p className="text-xs text-slate-400">
              Only active categories can be chosen for new donations in{' '}
              <strong className="text-slate-200">{activeChurch?.name}</strong>. Deactivation preserves historical references.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setCatName('');
              setIsCatModalOpen(true);
            }}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Donation Category</span>
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                <th className="py-2.5 px-4">Category Name</th>
                <th className="py-2.5 px-4 text-center">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500">
                    Loading donation categories...
                  </td>
                </tr>
              ) : categories.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500">
                    No donation categories created for this church yet.
                  </td>
                </tr>
              ) : (
                categories.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-semibold text-white">{c.name}</td>
                    <td className="py-2.5 px-4 text-center font-mono text-[11px] font-semibold">
                      <span className={c.is_active ? 'text-emerald-400' : 'text-slate-500'}>
                        {c.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => toggleCategoryStatus(c)}
                        className="text-xs text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer"
                      >
                        {c.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. EXPENSE CATEGORIES (PER-CHURCH) */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <Wallet className="w-5 h-5 text-amber-400" />
              <span>Expense Categories</span>
            </h2>
            <p className="text-xs text-slate-400">
              Church-specific expense categories for{' '}
              <strong className="text-slate-200">{activeChurch?.name}</strong> (e.g., Utilities, Staff Salaries, Maintenance).
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setExpCatName('');
              setIsExpCatModalOpen(true);
            }}
            className="bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Expense Category</span>
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                <th className="py-2.5 px-4">Expense Category Name</th>
                <th className="py-2.5 px-4 text-center">Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500">
                    Loading expense categories...
                  </td>
                </tr>
              ) : expenseCategories.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500">
                    No expense categories defined for this church yet. Add your first expense category above.
                  </td>
                </tr>
              ) : (
                expenseCategories.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-semibold text-white">{c.name}</td>
                    <td className="py-2.5 px-4 text-center font-mono text-[11px] font-semibold">
                      <span className={c.is_active ? 'text-emerald-400' : 'text-slate-500'}>
                        {c.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => toggleExpenseCategoryStatus(c)}
                        className="text-xs text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer"
                      >
                        {c.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. CASH & BANK ACCOUNTS */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              <Landmark className="w-5 h-5 text-emerald-400" />
              <span>Cash &amp; Bank Accounts</span>
            </h2>
            <p className="text-xs text-slate-400">
              Accounts that receive donations and pay church expenses for{' '}
              <strong className="text-slate-200">{activeChurch?.name}</strong>.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setIsAccModalOpen(true);
            }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
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
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    Loading church accounts...
                  </td>
                </tr>
              ) : accounts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-500">
                    No cash or bank accounts configured for this church yet.
                  </td>
                </tr>
              ) : (
                accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-semibold text-white">{a.account_name}</td>
                    <td className="py-2.5 px-4 uppercase font-mono text-slate-400">{a.account_type}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-300">
                      {a.bank_name ? `${a.bank_name} (${a.account_number_mask || '••••'})` : 'Cash Box'}
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono text-[11px] font-semibold">
                      <span className={a.is_active ? 'text-emerald-400' : 'text-slate-500'}>
                        {a.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => toggleAccountStatus(a)}
                        className="text-xs text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer"
                      >
                        {a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE DONATION CATEGORY MODAL */}
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
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsCatModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg cursor-pointer"
              >
                {isSubmitting ? 'Saving...' : 'Add Category'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* CREATE EXPENSE CATEGORY MODAL */}
      {isExpCatModalOpen && (
        <Modal
          isOpen={isExpCatModalOpen}
          onClose={() => setIsExpCatModalOpen(false)}
          title={`Add Expense Category · ${activeChurch?.code || 'Church'}`}
          maxWidth="sm"
        >
          <form onSubmit={handleCreateExpenseCategory} className="space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {errorMsg}
              </div>
            )}
            <p className="text-[11px] text-slate-400">
              This category will belong strictly to <strong className="text-slate-200">{activeChurch?.name}</strong>.
            </p>
            <div>
              <label className="block text-slate-300 font-medium mb-1">Expense Category Name</label>
              <input
                type="text"
                value={expCatName}
                onChange={(e) => setExpCatName(e.target.value)}
                required
                placeholder="e.g. Utilities & Electricity"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsExpCatModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg cursor-pointer"
              >
                {isSubmitting ? 'Saving...' : 'Add Expense Category'}
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
          title="Add Cash / Bank Account"
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
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg cursor-pointer"
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


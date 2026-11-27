import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase, supabaseConfig } from '../../lib/supabase';
import type {
  DonationCategory,
  ExpenseCategory,
  ReceivingAccount,
  AccountType,
} from '../../types/database';
import {
  extractSupabaseErrorMessage,
  validateReceivingAccountInput,
} from '../../lib/domain-logic';
import { Modal } from '../common/Modals';
import { FolderTree, Plus, Landmark, Wallet, AlertCircle, Pencil } from 'lucide-react';

function isMissingRpcError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const obj = err as Record<string, unknown>;
  const code = typeof obj.code === 'string' ? obj.code : '';
  const message = typeof obj.message === 'string' ? obj.message.toLowerCase() : '';
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    message.includes('could not find the function') ||
    (message.includes('function') && message.includes('does not exist'))
  );
}

function isPreviewModeSession(): boolean {
  if (typeof window !== 'undefined' && window.sessionStorage.getItem('cms_preview_persona')) {
    return true;
  }
  return !supabaseConfig.isConfigured || !supabaseConfig.hasAnonKey;
}

export const CategoriesScreen: React.FC = () => {
  const { activeChurch } = useAuth();

  const [categories, setCategories] = useState<DonationCategory[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Donation Category Modal
  const [isCatModalOpen, setIsCatModalOpen] = useState(false);
  const [catName, setCatName] = useState('');

  // Expense Category Modal
  const [isExpCatModalOpen, setIsExpCatModalOpen] = useState(false);
  const [expCatName, setExpCatName] = useState('');

  // Account Modal (Add & Edit)
  const [isAccModalOpen, setIsAccModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<ReceivingAccount | null>(null);
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<AccountType>('cash');
  const [bankName, setBankName] = useState('');
  const [accountNumberMask, setAccountNumberMask] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isPreview = isPreviewModeSession();

  const fetchData = async () => {
    if (!activeChurch) {
      setIsLoading(false);
      return;
    }

    if (isPreview) {
      const now = new Date().toISOString();
      setCategories((prev) =>
        prev.length > 0
          ? prev
          : [
              { id: 'preview-cat-1', church_id: activeChurch.id, name: 'Tithe', is_active: true, created_at: now },
              { id: 'preview-cat-2', church_id: activeChurch.id, name: 'Building Fund', is_active: true, created_at: now },
            ]
      );
      setExpenseCategories((prev) =>
        prev.length > 0
          ? prev
          : [
              { id: 'preview-exp-1', church_id: activeChurch.id, name: 'Utilities & Electricity', is_active: true, created_at: now },
              { id: 'preview-exp-2', church_id: activeChurch.id, name: 'Building Maintenance', is_active: true, created_at: now },
            ]
      );
      setAccounts((prev) =>
        prev.length > 0
          ? prev
          : [
              {
                id: 'preview-acc-1',
                church_id: activeChurch.id,
                account_name: 'Church General Cash',
                account_type: 'cash',
                bank_name: null,
                account_number_mask: null,
                is_active: true,
                created_at: now,
              },
              {
                id: 'preview-acc-2',
                church_id: activeChurch.id,
                account_name: 'SBI Main Church Account',
                account_type: 'bank',
                bank_name: 'State Bank of India',
                account_number_mask: '•••• 8912',
                is_active: true,
                created_at: now,
              },
            ]
      );
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPageError(null);

    try {
      const [
        { data: catData, error: catError },
        { data: expCatData, error: expCatError },
        { data: accData, error: accError },
      ] = await Promise.all([
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

      if (catError) throw catError;
      if (expCatError) throw expCatError;
      if (accError) throw accError;

      setCategories((catData || []) as DonationCategory[]);
      setExpenseCategories((expCatData || []) as ExpenseCategory[]);
      setAccounts((accData || []) as ReceivingAccount[]);
    } catch (err: unknown) {
      console.error('Error fetching categories & accounts:', err);
      setPageError(extractSupabaseErrorMessage(err, 'Unable to load categories and accounts.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [activeChurch?.id]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChurch) {
      setErrorMsg('No active church is selected.');
      return;
    }

    const trimmed = catName.trim();
    if (!trimmed) {
      setErrorMsg('Category name is required.');
      return;
    }

    if (categories.some((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setErrorMsg(`A donation category named "${trimmed}" already exists for this church.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      if (isPreview) {
        const created: DonationCategory = {
          id: `preview-cat-${Date.now()}`,
          church_id: activeChurch.id,
          name: trimmed,
          is_active: true,
          created_at: new Date().toISOString(),
        };
        setCategories((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
        setIsCatModalOpen(false);
        setCatName('');
        return;
      }

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
      setErrorMsg(extractSupabaseErrorMessage(err, 'Failed to add donation category.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateExpenseCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChurch) {
      setErrorMsg('No active church is selected.');
      return;
    }

    const trimmed = expCatName.trim();
    if (!trimmed) {
      setErrorMsg('Expense category name is required.');
      return;
    }

    if (expenseCategories.some((c) => c.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      setErrorMsg(`An expense category named "${trimmed}" already exists for this church.`);
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      if (isPreview) {
        const created: ExpenseCategory = {
          id: `preview-exp-${Date.now()}`,
          church_id: activeChurch.id,
          name: trimmed,
          is_active: true,
          created_at: new Date().toISOString(),
        };
        setExpenseCategories((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
        );
        setIsExpCatModalOpen(false);
        setExpCatName('');
        return;
      }

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
      const msg = extractSupabaseErrorMessage(err, 'Failed to add expense category.');
      if (msg.includes('uq_expense_categories_church_name') || msg.toLowerCase().includes('duplicate')) {
        setErrorMsg(`An expense category named "${trimmed}" already exists for this church.`);
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAddAccountModal = () => {
    setErrorMsg(null);
    setEditingAccount(null);
    setAccName('');
    setAccType('cash');
    setBankName('');
    setAccountNumberMask('');
    setIsAccModalOpen(true);
  };

  const openEditAccountModal = (account: ReceivingAccount) => {
    setErrorMsg(null);
    setEditingAccount(account);
    setAccName(account.account_name);
    setAccType(account.account_type);
    setBankName(account.bank_name || '');
    setAccountNumberMask(account.account_number_mask || '');
    setIsAccModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChurch) {
      setErrorMsg('No active church is selected. Please select a church and try again.');
      return;
    }

    const validation = validateReceivingAccountInput({
      accountName: accName,
      accountType: accType,
      bankName,
      accountNumberMask,
      existingAccounts: accounts,
      editingAccountId: editingAccount?.id || null,
    });

    if (!validation.valid) {
      setErrorMsg(validation.error || 'Please verify the account details.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const { account_name, account_type, bank_name, account_number_mask } = validation.normalized;

      if (isPreview) {
        if (editingAccount) {
          setAccounts((prev) =>
            prev
              .map((a) =>
                a.id === editingAccount.id
                  ? { ...a, account_name, account_type, bank_name, account_number_mask }
                  : a
              )
              .sort((a, b) => a.account_name.localeCompare(b.account_name))
          );
        } else {
          const created: ReceivingAccount = {
            id: `preview-acc-${Date.now()}`,
            church_id: activeChurch.id,
            account_name,
            account_type,
            bank_name,
            account_number_mask,
            is_active: true,
            created_at: new Date().toISOString(),
          };
          setAccounts((prev) =>
            [...prev, created].sort((a, b) => a.account_name.localeCompare(b.account_name))
          );
        }

        setIsAccModalOpen(false);
        setEditingAccount(null);
        setAccName('');
        setAccType('cash');
        setBankName('');
        setAccountNumberMask('');
        return;
      }

      if (editingAccount) {
        const { error: rpcError } = await supabase.rpc('update_receiving_account', {
          p_account_id: editingAccount.id,
          p_account_name: account_name,
          p_account_type: account_type,
          p_bank_name: bank_name,
          p_account_number_mask: account_number_mask,
        });

        if (rpcError) {
          if (isMissingRpcError(rpcError)) {
            const { error: updateError } = await supabase
              .from('receiving_accounts')
              .update({
                account_name,
                account_type,
                bank_name,
                account_number_mask,
              })
              .eq('id', editingAccount.id);

            if (updateError) throw updateError;
          } else {
            throw rpcError;
          }
        }
      } else {
        const { error: rpcError } = await supabase.rpc('create_receiving_account', {
          p_church_id: activeChurch.id,
          p_account_name: account_name,
          p_account_type: account_type,
          p_bank_name: bank_name,
          p_account_number_mask: account_number_mask,
        });

        if (rpcError) {
          if (isMissingRpcError(rpcError)) {
            const { error: insertError } = await supabase.from('receiving_accounts').insert({
              church_id: activeChurch.id,
              account_name,
              account_type,
              bank_name,
              account_number_mask,
              is_active: true,
            });

            if (insertError) throw insertError;
          } else {
            throw rpcError;
          }
        }
      }

      setIsAccModalOpen(false);
      setEditingAccount(null);
      setAccName('');
      setAccType('cash');
      setBankName('');
      setAccountNumberMask('');
      await fetchData();
    } catch (err: unknown) {
      setErrorMsg(
        extractSupabaseErrorMessage(
          err,
          editingAccount ? 'Failed to update account.' : 'Failed to add account.'
        )
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleCategoryStatus = async (category: DonationCategory) => {
    setPageError(null);
    if (isPreview) {
      setCategories((prev) =>
        prev.map((c) => (c.id === category.id ? { ...c, is_active: !c.is_active } : c))
      );
      return;
    }
    setTogglingId(category.id);
    try {
      const { error } = await supabase
        .from('donation_categories')
        .update({ is_active: !category.is_active })
        .eq('id', category.id);
      if (error) throw error;
      await fetchData();
    } catch (err: unknown) {
      setPageError(extractSupabaseErrorMessage(err, 'Failed to update donation category status.'));
    } finally {
      setTogglingId(null);
    }
  };

  const toggleExpenseCategoryStatus = async (category: ExpenseCategory) => {
    setPageError(null);
    if (isPreview) {
      setExpenseCategories((prev) =>
        prev.map((c) => (c.id === category.id ? { ...c, is_active: !c.is_active } : c))
      );
      return;
    }
    setTogglingId(category.id);
    try {
      const { error } = await supabase
        .from('expense_categories')
        .update({ is_active: !category.is_active })
        .eq('id', category.id);
      if (error) throw error;
      await fetchData();
    } catch (err: unknown) {
      setPageError(extractSupabaseErrorMessage(err, 'Failed to update expense category status.'));
    } finally {
      setTogglingId(null);
    }
  };

  const toggleAccountStatus = async (account: ReceivingAccount) => {
    setPageError(null);
    const nextActive = !account.is_active;
    if (isPreview) {
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, is_active: nextActive } : a))
      );
      return;
    }
    setTogglingId(account.id);
    try {
      const { error: rpcError } = await supabase.rpc('toggle_receiving_account_status', {
        p_account_id: account.id,
        p_is_active: nextActive,
      });

      if (rpcError) {
        if (isMissingRpcError(rpcError)) {
          const { error: updateError } = await supabase
            .from('receiving_accounts')
            .update({ is_active: nextActive })
            .eq('id', account.id);
          if (updateError) throw updateError;
        } else {
          throw rpcError;
        }
      }
      await fetchData();
    } catch (err: unknown) {
      setPageError(extractSupabaseErrorMessage(err, 'Failed to update account status.'));
    } finally {
      setTogglingId(null);
    }
  };

  const formatAccountDetail = (account: ReceivingAccount): string => {
    if (account.account_type === 'bank') {
      if (account.bank_name && account.account_number_mask) {
        return `${account.bank_name} (${account.account_number_mask})`;
      }
      if (account.bank_name) return account.bank_name;
      if (account.account_number_mask) return `Bank (${account.account_number_mask})`;
      return 'Bank Account';
    }
    return 'Cash Box';
  };

  return (
    <div className="space-y-8">
      {pageError && (
        <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/30 text-red-300 text-xs p-3.5 rounded-xl">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
          <span className="flex-1">{pageError}</span>
          <button
            type="button"
            onClick={() => setPageError(null)}
            className="text-red-200 hover:text-white underline text-[11px] cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

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
                        disabled={togglingId === c.id}
                        onClick={() => toggleCategoryStatus(c)}
                        className="text-xs text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer disabled:opacity-50"
                      >
                        {togglingId === c.id ? 'Updating...' : c.is_active ? 'Deactivate' : 'Activate'}
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
                        disabled={togglingId === c.id}
                        onClick={() => toggleExpenseCategoryStatus(c)}
                        className="text-xs text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer disabled:opacity-50"
                      >
                        {togglingId === c.id ? 'Updating...' : c.is_active ? 'Deactivate' : 'Activate'}
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
            onClick={openAddAccountModal}
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
                      {formatAccountDetail(a)}
                    </td>
                    <td className="py-2.5 px-4 text-center font-mono text-[11px] font-semibold">
                      <span className={a.is_active ? 'text-emerald-400' : 'text-slate-500'}>
                        {a.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => openEditAccountModal(a)}
                          className="text-xs text-slate-300 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                          title="Edit Account"
                        >
                          <Pencil className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          disabled={togglingId === a.id}
                          onClick={() => toggleAccountStatus(a)}
                          className="text-xs text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer disabled:opacity-50"
                        >
                          {togglingId === a.id ? 'Updating...' : a.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
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
                className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg cursor-pointer disabled:opacity-50"
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
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Add Expense Category'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* CREATE / EDIT ACCOUNT MODAL */}
      {isAccModalOpen && (
        <Modal
          isOpen={isAccModalOpen}
          onClose={() => {
            setIsAccModalOpen(false);
            setEditingAccount(null);
          }}
          title={editingAccount ? 'Edit Cash / Bank Account' : 'Add Cash / Bank Account'}
          maxWidth="sm"
        >
          <form onSubmit={handleSaveAccount} className="space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl leading-relaxed">
                {errorMsg}
              </div>
            )}
            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Account Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={accName}
                onChange={(e) => {
                  setAccName(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
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
                onClick={() => {
                  setIsAccModalOpen(false);
                  setEditingAccount(null);
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : editingAccount ? 'Save Changes' : 'Add Account'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

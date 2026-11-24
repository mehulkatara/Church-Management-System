import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { ScreenId } from '../common/Sidebar';
import type {
  Expense,
  ExpenseCategory,
  ReceivingAccount,
  PaymentMethod,
} from '../../types/database';
import {
  formatINR,
  getFinancialYearOptions,
  validateExpenseInput,
  computeExpenseCurrentMonthSummary,
  EXPENSE_PAYMENT_METHODS,
} from '../../lib/domain-logic';
import { Modal, ReasonModal } from '../common/Modals';
import {
  Wallet,
  Plus,
  Search,
  Eye,
  Edit3,
  Trash2,
  XCircle,
  AlertCircle,
} from 'lucide-react';

interface ExpensesScreenProps {
  onNavigate?: (screen: ScreenId) => void;
}

function getTodayKolkataISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return fallback;
}

export const ExpensesScreen: React.FC<ExpensesScreenProps> = ({ onNavigate }) => {
  const { activeChurch, activeRole, isPlatformAdmin } = useAuth();
  const canManageExpenses =
    isPlatformAdmin || activeRole === 'admin' || activeRole === 'accountant';

  const fyOptions = useMemo(() => getFinancialYearOptions(5), []);
  const [selectedFy, setSelectedFy] = useState(fyOptions[0].fyCode);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState('');
  const [filterAccountId, setFilterAccountId] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [includeCancelled, setIncludeCancelled] = useState(false);

  // Selected expense for Details / Correct / Cancel modals
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [isCorrectModalOpen, setIsCorrectModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);

  // Record Expense Form State
  const [newAmount, setNewAmount] = useState('');
  const [newDate, setNewDate] = useState(getTodayKolkataISO);
  const [newCategoryId, setNewCategoryId] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [newPaymentMethod, setNewPaymentMethod] = useState<PaymentMethod>('Cash');
  const [newPayeeName, setNewPayeeName] = useState('');
  const [newBillRef, setNewBillRef] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // Correct Expense Form State
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('Cash');
  const [editPayeeName, setEditPayeeName] = useState('');
  const [editBillRef, setEditBillRef] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editReason, setEditReason] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeExpenseCategories = useMemo(
    () => expenseCategories.filter((c) => c.is_active),
    [expenseCategories]
  );

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active),
    [accounts]
  );

  const fetchExpensesData = async () => {
    if (!supabase || !activeChurch || !canManageExpenses) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      let expQuery = supabase
        .from('expenses')
        .select(`
          *,
          category:expense_categories(*),
          paid_from_account:receiving_accounts(*)
        `)
        .eq('church_id', activeChurch.id)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (!includeCancelled) {
        expQuery = expQuery.is('deleted_at', null);
      }

      const [
        { data: expData, error: expError },
        { data: catData, error: catError },
        { data: accData, error: accError },
      ] = await Promise.all([
        expQuery,
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

      if (expError) throw expError;
      if (catError) throw catError;
      if (accError) throw accError;

      setExpenses((expData || []) as Expense[]);
      setExpenseCategories((catData || []) as ExpenseCategory[]);
      setAccounts((accData || []) as ReceivingAccount[]);
    } catch (err: unknown) {
      console.error('Error loading church expenses:', err);
      setLoadError(getErrorMessage(err, 'Unable to load expense records.'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchExpensesData();
  }, [activeChurch, includeCancelled, canManageExpenses]);

  const currentFyInfo =
    fyOptions.find((fy) => fy.fyCode === selectedFy) || fyOptions[0];

  const fyActiveExpenses = useMemo(
    () =>
      expenses.filter(
        (e) =>
          !e.deleted_at &&
          e.expense_date >= currentFyInfo.startDate &&
          e.expense_date <= currentFyInfo.endDate
      ),
    [expenses, currentFyInfo.startDate, currentFyInfo.endDate]
  );

  const filteredExpenses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return expenses.filter((e) => {
      if (e.expense_date < currentFyInfo.startDate || e.expense_date > currentFyInfo.endDate) {
        return false;
      }
      if (filterCategoryId && e.category_id !== filterCategoryId) return false;
      if (filterAccountId && e.paid_from_account_id !== filterAccountId) return false;
      if (filterPaymentMethod && e.payment_method !== filterPaymentMethod) return false;
      if (q) {
        const payeeMatch = e.payee_name.toLowerCase().includes(q);
        const refMatch = (e.bill_reference || '').toLowerCase().includes(q);
        const notesMatch = (e.notes || '').toLowerCase().includes(q);
        const catMatch = (e.category?.name || '').toLowerCase().includes(q);
        if (!payeeMatch && !refMatch && !notesMatch && !catMatch) return false;
      }
      return true;
    });
  }, [
    expenses,
    currentFyInfo.startDate,
    currentFyInfo.endDate,
    filterCategoryId,
    filterAccountId,
    filterPaymentMethod,
    searchQuery,
  ]);

  const filteredActiveTotal = useMemo(
    () =>
      filteredExpenses
        .filter((e) => !e.deleted_at)
        .reduce((sum, e) => sum + Number(e.amount), 0),
    [filteredExpenses]
  );

  const filteredActiveCount = useMemo(
    () => filteredExpenses.filter((e) => !e.deleted_at).length,
    [filteredExpenses]
  );

  const currentMonthSummary = useMemo(
    () => computeExpenseCurrentMonthSummary(expenses),
    [expenses]
  );

  const handleOpenRecordModal = () => {
    setActionError(null);
    setNewAmount('');
    setNewDate(getTodayKolkataISO());
    setNewCategoryId(activeExpenseCategories[0]?.id || '');
    setNewAccountId(activeAccounts[0]?.id || '');
    setNewPaymentMethod('Cash');
    setNewPayeeName('');
    setNewBillRef('');
    setNewNotes('');
    setIdempotencyKey(crypto.randomUUID());
    setIsRecordModalOpen(true);
  };

  const handleRecordExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !activeChurch) return;

    const validation = validateExpenseInput({
      amount: newAmount,
      expenseDate: newDate,
      categoryId: newCategoryId,
      paidFromAccountId: newAccountId,
      paymentMethod: newPaymentMethod,
      payeeName: newPayeeName,
      billReference: newBillRef,
      notes: newNotes,
    });

    if (!validation.valid || !validation.sanitized) {
      setActionError(validation.error || 'Please check expense details.');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    try {
      const { error } = await supabase.rpc('record_expense', {
        p_church_id: activeChurch.id,
        p_expense_date: validation.sanitized.expenseDate,
        p_category_id: validation.sanitized.categoryId,
        p_paid_from_account_id: validation.sanitized.paidFromAccountId,
        p_amount: validation.sanitized.amount,
        p_payment_method: validation.sanitized.paymentMethod,
        p_payee_name: validation.sanitized.payeeName,
        p_bill_reference: validation.sanitized.billReference,
        p_notes: validation.sanitized.notes,
        p_idempotency_key: idempotencyKey,
      });

      if (error) throw error;

      setIsRecordModalOpen(false);
      await fetchExpensesData();
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Failed to record expense.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenCorrectModal = (expense: Expense) => {
    setSelectedExpense(expense);
    setEditAmount(String(expense.amount));
    setEditDate(expense.expense_date);
    setEditCategoryId(expense.category_id);
    setEditAccountId(expense.paid_from_account_id);
    setEditPaymentMethod(expense.payment_method);
    setEditPayeeName(expense.payee_name);
    setEditBillRef(expense.bill_reference || '');
    setEditNotes(expense.notes || '');
    setEditReason('');
    setActionError(null);
    setIsCorrectModalOpen(true);
  };

  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !selectedExpense) return;

    const validation = validateExpenseInput({
      amount: editAmount,
      expenseDate: editDate,
      categoryId: editCategoryId,
      paidFromAccountId: editAccountId,
      paymentMethod: editPaymentMethod,
      payeeName: editPayeeName,
      billReference: editBillRef,
      notes: editNotes,
    });

    if (!validation.valid || !validation.sanitized) {
      setActionError(validation.error || 'Please verify corrected expense fields.');
      return;
    }

    if (!editReason || editReason.trim().length < 3) {
      setActionError('A clear audit reason of at least 3 characters is strictly required.');
      return;
    }

    setIsSubmitting(true);
    setActionError(null);

    try {
      const { error } = await supabase.rpc('correct_expense', {
        p_expense_id: selectedExpense.id,
        p_new_expense_date: validation.sanitized.expenseDate,
        p_new_category_id: validation.sanitized.categoryId,
        p_new_paid_from_account_id: validation.sanitized.paidFromAccountId,
        p_new_amount: validation.sanitized.amount,
        p_new_payment_method: validation.sanitized.paymentMethod,
        p_new_payee_name: validation.sanitized.payeeName,
        p_new_bill_reference: validation.sanitized.billReference,
        p_new_notes: validation.sanitized.notes,
        p_reason: editReason.trim(),
      });

      if (error) throw error;

      setIsCorrectModalOpen(false);
      setSelectedExpense(null);
      await fetchExpensesData();
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Failed to update expense.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmCancel = async (reason: string) => {
    if (!supabase || !selectedExpense) return;
    setIsSubmitting(true);
    setActionError(null);

    try {
      const { error } = await supabase.rpc('cancel_expense', {
        p_expense_id: selectedExpense.id,
        p_reason: reason,
      });

      if (error) throw error;

      setIsCancelModalOpen(false);
      setSelectedExpense(null);
      await fetchExpensesData();
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, 'Failed to cancel expense.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!canManageExpenses) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-xs text-slate-300 space-y-2">
        <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Admin or Accountant Access Required</span>
        </div>
        <p className="text-slate-400">
          Church expenses and expense categories are restricted to Admins and Accountants.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Wallet className="w-5 h-5 text-amber-400" />
            <span>Church Expenses</span>
          </h1>
          <p className="text-xs text-slate-400">
            Outgoing payments &amp; church-specific expense ledger for{' '}
            <strong className="text-slate-200">{activeChurch?.name}</strong>
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenRecordModal}
          className="bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Record Expense</span>
        </button>
      </div>

      {/* Missing setup notice if categories or accounts don't exist yet */}
      {!isLoading && (activeExpenseCategories.length === 0 || activeAccounts.length === 0) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="text-amber-200 space-y-0.5">
            <strong className="block text-amber-300">Setup needed before recording expenses</strong>
            <span className="text-slate-300">
              {activeExpenseCategories.length === 0
                ? 'Add at least one active Expense Category for this church'
                : 'Add at least one active Cash or Bank Account'}{' '}
              in Categories &amp; Accounts.
            </span>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('categories')}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 rounded-xl font-semibold whitespace-nowrap cursor-pointer self-start sm:self-auto"
            >
              Open Categories &amp; Accounts
            </button>
          )}
        </div>
      )}

      {/* Summary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1.5">
          <span className="text-xs text-slate-400 font-medium block">
            {searchQuery || filterCategoryId || filterAccountId || filterPaymentMethod
              ? `Filtered Expenses (${currentFyInfo.fyCode})`
              : `FY Expenses (${currentFyInfo.fyCode})`}
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-400">
            {formatINR(filteredActiveTotal)}
          </div>
          <span className="text-[11px] text-slate-500 font-mono tabular-nums block">
            {filteredActiveCount} active entr{filteredActiveCount === 1 ? 'y' : 'ies'} ({fyActiveExpenses.length} in FY)
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1.5">
          <span className="text-xs text-slate-400 font-medium block">
            This Month ({currentMonthSummary.monthLabel})
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-rose-400">
            {formatINR(currentMonthSummary.totalAmount)}
          </div>
          <span className="text-[11px] text-slate-500 font-mono tabular-nums block">
            {currentMonthSummary.entryCount} payment{currentMonthSummary.entryCount === 1 ? '' : 's'} this month
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-1.5">
          <span className="text-xs text-slate-400 font-medium block">
            Active Expense Categories
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-white">
            {activeExpenseCategories.length}
          </div>
          {onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate('categories')}
              className="text-[11px] text-sky-400 hover:text-sky-300 underline font-medium cursor-pointer block"
            >
              Manage church expense categories &rarr;
            </button>
          ) : (
            <span className="text-[11px] text-slate-500 font-mono block">
              Scoped to {activeChurch?.code}
            </span>
          )}
        </div>
      </div>

      {loadError && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs">
          {loadError}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <select
            aria-label="Financial Year"
            value={selectedFy}
            onChange={(e) => setSelectedFy(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-amber-500"
          >
            {fyOptions.map((fy) => (
              <option key={fy.fyCode} value={fy.fyCode}>
                {fy.label}
              </option>
            ))}
          </select>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search payee, bill ref, notes..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>

          <select
            aria-label="Filter by Expense Category"
            value={filterCategoryId}
            onChange={(e) => setFilterCategoryId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">All Expense Categories</option>
            {expenseCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.is_active ? '' : ' (Inactive)'}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by Paid-From Account"
            value={filterAccountId}
            onChange={(e) => setFilterAccountId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">All Paid-From Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by Payment Method"
            value={filterPaymentMethod}
            onChange={(e) => setFilterPaymentMethod(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">All Payment Methods</option>
            {EXPENSE_PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={(e) => setIncludeCancelled(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-amber-500 focus:ring-0"
            />
            <span>Include Cancelled / Deleted expenses</span>
          </label>
          <span className="text-[11px] text-slate-500 font-mono">
            Cancelled expenses are excluded from active totals · Audit log preserved
          </span>
        </div>
      </div>

      {/* Expense Register Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Payee / Bill Ref</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Method / Paid From</th>
                <th className="py-3 px-4 text-right">Amount (₹)</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Loading church expense records...
                  </td>
                </tr>
              ) : filteredExpenses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No expenses recorded for {currentFyInfo.label} under the current filters.
                  </td>
                </tr>
              ) : (
                filteredExpenses.map((exp) => {
                  const isDeleted = Boolean(exp.deleted_at);
                  return (
                    <tr
                      key={exp.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isDeleted ? 'bg-red-950/10 text-slate-400' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-300 whitespace-nowrap">
                        {exp.expense_date}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-semibold text-white block">{exp.payee_name}</span>
                        {exp.bill_reference && (
                          <span className="text-[11px] font-mono text-slate-400 block">
                            Ref: {exp.bill_reference}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-200 font-medium">
                        {exp.category?.name || 'Category'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-white font-medium block">{exp.payment_method}</span>
                        <span className="text-[11px] text-slate-400 block">
                          {exp.paid_from_account?.account_name || 'Account'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-amber-400 whitespace-nowrap">
                        {formatINR(Number(exp.amount))}
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-[11px] font-semibold">
                        <span className={isDeleted ? 'text-red-400' : 'text-emerald-400'}>
                          {isDeleted ? 'CANCELLED' : 'ACTIVE'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setSelectedExpense(exp);
                          }}
                          title="View Expense Details"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        {!isDeleted && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleOpenCorrectModal(exp)}
                              title="Correct Expense"
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActionError(null);
                                setSelectedExpense(exp);
                                setIsCancelModalOpen(true);
                              }}
                              title="Cancel Expense"
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
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

      {/* RECORD EXPENSE MODAL */}
      {isRecordModalOpen && (
        <Modal
          isOpen={isRecordModalOpen}
          onClose={() => setIsRecordModalOpen(false)}
          title={`Record Church Expense · ${activeChurch?.code || ''}`}
          maxWidth="lg"
        >
          <form onSubmit={handleRecordExpense} className="space-y-4 text-xs">
            {actionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {actionError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Amount (INR) <span className="text-red-400">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                  required
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono tabular-nums text-amber-400 font-semibold focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Expense Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Expense Category <span className="text-red-400">*</span>
                </label>
                <select
                  value={newCategoryId}
                  onChange={(e) => setNewCategoryId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="">Select expense category...</option>
                  {activeExpenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Paid-From Account <span className="text-red-400">*</span>
                </label>
                <select
                  value={newAccountId}
                  onChange={(e) => setNewAccountId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="">Select paid-from account...</option>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Payment Method <span className="text-red-400">*</span>
                </label>
                <select
                  value={newPaymentMethod}
                  onChange={(e) => setNewPaymentMethod(e.target.value as PaymentMethod)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                >
                  {EXPENSE_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Payee / Vendor Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newPayeeName}
                  onChange={(e) => setNewPayeeName(e.target.value)}
                  required
                  placeholder="e.g. TNEB Electricity, City Water Works"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Bill / Voucher Reference (Optional)
              </label>
              <input
                type="text"
                value={newBillRef}
                onChange={(e) => setNewBillRef(e.target.value)}
                placeholder="e.g. INV-2026-104 or Voucher #18"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Notes (Optional)</label>
              <textarea
                rows={2}
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Optional description or payment remarks..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsRecordModalOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || activeExpenseCategories.length === 0 || activeAccounts.length === 0}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-colors cursor-pointer"
              >
                {isSubmitting ? 'Saving Expense...' : 'Save Expense'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* DETAILS MODAL */}
      {selectedExpense && !isCorrectModalOpen && !isCancelModalOpen && (
        <Modal
          isOpen={Boolean(selectedExpense)}
          onClose={() => setSelectedExpense(null)}
          title={`Expense Details · ${selectedExpense.payee_name}`}
          maxWidth="lg"
        >
          <div className="space-y-4 text-xs">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 grid grid-cols-2 gap-3">
              <div>
                <span className="text-slate-500 block">Payee / Vendor</span>
                <span className="text-white font-semibold text-sm">{selectedExpense.payee_name}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Amount</span>
                <span className="font-mono tabular-nums font-bold text-amber-400 text-sm">
                  {formatINR(Number(selectedExpense.amount))}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Expense Date</span>
                <span className="font-mono tabular-nums text-slate-200">{selectedExpense.expense_date}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Expense Category</span>
                <span className="text-slate-200">{selectedExpense.category?.name || 'Category'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Paid-From Account</span>
                <span className="text-slate-200">
                  {selectedExpense.paid_from_account?.account_name || 'Account'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Payment Method</span>
                <span className="text-slate-200">{selectedExpense.payment_method}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Bill / Voucher Reference</span>
                <span className="font-mono text-slate-300">
                  {selectedExpense.bill_reference || 'None'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Status</span>
                <span
                  className={`font-mono font-semibold ${
                    selectedExpense.deleted_at ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  {selectedExpense.deleted_at ? 'CANCELLED' : 'ACTIVE'}
                </span>
              </div>
              {selectedExpense.notes && (
                <div className="col-span-2 pt-2 border-t border-slate-800/80">
                  <span className="text-slate-500 block mb-0.5">Notes</span>
                  <p className="text-slate-200 leading-relaxed">{selectedExpense.notes}</p>
                </div>
              )}
            </div>

            {selectedExpense.deleted_at && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span>Cancelled Expense Notice</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Cancelled on: {new Date(selectedExpense.deleted_at).toLocaleString('en-IN')}.
                  <br />
                  Reason: <em>"{selectedExpense.deletion_reason || 'No reason specified'}"</em>.
                  Excluded from active totals while full history remains in Audit History.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedExpense(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>

              {!selectedExpense.deleted_at && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenCorrectModal(selectedExpense)}
                    className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Correct Expense</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCancelModalOpen(true)}
                    className="px-3.5 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Cancel / Mark as Deleted</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* CORRECT EXPENSE MODAL */}
      {isCorrectModalOpen && selectedExpense && (
        <Modal
          isOpen={isCorrectModalOpen}
          onClose={() => setIsCorrectModalOpen(false)}
          title="Correct Saved Expense"
          maxWidth="lg"
        >
          <form onSubmit={handleSubmitCorrection} className="space-y-4 text-xs">
            {actionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {actionError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Amount (INR)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono tabular-nums text-amber-400 font-semibold focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Expense Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Expense Category</label>
                <select
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                >
                  {expenseCategories
                    .filter((c) => c.is_active || c.id === selectedExpense.category_id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.is_active ? '' : ' (Inactive)'}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Paid-From Account</label>
                <select
                  value={editAccountId}
                  onChange={(e) => setEditAccountId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                >
                  {accounts
                    .filter((a) => a.is_active || a.id === selectedExpense.paid_from_account_id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.account_name}
                        {a.is_active ? '' : ' (Inactive)'}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Payment Method</label>
                <select
                  value={editPaymentMethod}
                  onChange={(e) => setEditPaymentMethod(e.target.value as PaymentMethod)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                >
                  {EXPENSE_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Payee / Vendor Name</label>
                <input
                  type="text"
                  value={editPayeeName}
                  onChange={(e) => setEditPayeeName(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Bill / Voucher Reference
              </label>
              <input
                type="text"
                value={editBillRef}
                onChange={(e) => setEditBillRef(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Notes</label>
              <textarea
                rows={2}
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Mandatory Reason for Correction <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={2}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                required
                placeholder="e.g. Updated amount to match GST bill INV-204..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsCorrectModalOpen(false)}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors cursor-pointer"
              >
                {isSubmitting ? 'Saving Correction...' : 'Submit Correction'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* CANCEL EXPENSE REASON MODAL */}
      <ReasonModal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        onConfirm={handleConfirmCancel}
        title="Cancel / Mark Expense as Deleted"
        description="This expense will be marked as cancelled and excluded from active church totals while preserving the full record in the audit log."
        confirmLabel="Cancel Expense"
        isDestructive={true}
        isLoading={isSubmitting}
      />
    </div>
  );
};

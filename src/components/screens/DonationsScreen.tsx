import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Donation, DonationRevision, DonationCategory, ReceivingAccount, PaymentMethod } from '../../types/database';
import { formatINR, getFinancialYearOptions, formatSmsMessage } from '../../lib/domain-logic';
import { ReasonModal, Modal } from '../common/Modals';
import {
  Receipt,
  Search,
  Filter,
  Eye,
  Edit3,
  Trash2,
  Calendar,
  IndianRupee,
  AlertTriangle,
  History,
  CheckCircle,
  XCircle,
  MessageSquare,
  ArrowRight,
} from 'lucide-react';

export const DonationsScreen: React.FC = () => {
  const { activeChurch, activeRole, isPlatformAdmin } = useAuth();

  const [donations, setDonations] = useState<Donation[]>([]);
  const [categories, setCategories] = useState<DonationCategory[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [selectedFy, setSelectedFy] = useState(getFinancialYearOptions()[0].fyCode);
  const [searchReceipt, setSearchReceipt] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('');
  const [includeCancelled, setIncludeCancelled] = useState(false);

  // Selected Donation for Details Modal
  const [selectedDonation, setSelectedDonation] = useState<Donation | null>(null);
  const [revisions, setRevisions] = useState<DonationRevision[]>([]);
  const [isLoadingRevisions, setIsLoadingRevisions] = useState(false);

  // Modals for Actions
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [isCorrectModalOpen, setIsCorrectModalOpen] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Correction Form Fields
  const [editReceiptNumber, setEditReceiptNumber] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState<PaymentMethod>('Cash');
  const [editReference, setEditReference] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editReason, setEditReason] = useState('');

  const canEditOrCancel = isPlatformAdmin || activeRole === 'admin' || activeRole === 'accountant';

  const fetchDonations = async () => {
    if (!supabase || !activeChurch) return;
    setIsLoading(true);

    try {
      let query = supabase
        .from('donations')
        .select(`
          *,
          member:members(*),
          category:donation_categories(*),
          receiving_account:receiving_accounts(*)
        `)
        .eq('church_id', activeChurch.id)
        .order('donation_date', { ascending: false });

      if (!includeCancelled) {
        query = query.is('deleted_at', null);
      }

      const { data, error } = await query;
      if (error) throw error;
      setDonations((data || []) as Donation[]);

      // Lookups
      const { data: catData } = await supabase
        .from('donation_categories')
        .select('*')
        .eq('church_id', activeChurch.id);
      if (catData) setCategories(catData as DonationCategory[]);

      const { data: accData } = await supabase
        .from('receiving_accounts')
        .select('*')
        .eq('church_id', activeChurch.id);
      if (accData) setAccounts(accData as ReceivingAccount[]);
    } catch (err: unknown) {
      console.error('Error fetching donations:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDonations();
  }, [activeChurch, includeCancelled]);

  // Open Details Modal and fetch revisions
  const handleOpenDetails = async (donation: Donation) => {
    setSelectedDonation(donation);
    setIsLoadingRevisions(true);
    setActionError(null);

    try {
      if (supabase) {
        const { data } = await supabase
          .from('donation_revisions')
          .select('*')
          .eq('donation_id', donation.id)
          .order('revision_number', { ascending: true });
        setRevisions((data || []) as DonationRevision[]);
      }
    } catch (err) {
      console.error('Error loading revisions:', err);
    } finally {
      setIsLoadingRevisions(false);
    }
  };

  // Open Correction Modal
  const handleOpenCorrect = (donation: Donation) => {
    setEditReceiptNumber(donation.receipt_number);
    setEditAmount(String(donation.amount));
    setEditCategoryId(donation.category_id);
    setEditAccountId(donation.receiving_account_id);
    setEditDate(donation.donation_date);
    setEditPaymentMethod(donation.payment_method);
    setEditReference(donation.payment_reference || '');
    setEditNotes(donation.notes || '');
    setEditReason('');
    setActionError(null);
    setIsCorrectModalOpen(true);
  };

  // Submit Correction
  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !selectedDonation) return;

    if (!editReason || editReason.trim().length < 3) {
      setActionError('A clear audit reason of at least 3 characters is strictly required.');
      return;
    }

    setIsActionLoading(true);
    setActionError(null);

    try {
      const { data, error } = await supabase.rpc('correct_donation', {
        p_donation_id: selectedDonation.id,
        p_new_receipt_number: editReceiptNumber.trim(),
        p_new_amount: parseFloat(editAmount),
        p_new_category_id: editCategoryId,
        p_new_receiving_account_id: editAccountId,
        p_new_donation_date: editDate,
        p_new_payment_method: editPaymentMethod,
        p_new_payment_reference: editReference.trim() || null,
        p_new_notes: editNotes.trim() || null,
        p_reason: editReason.trim(),
      });

      if (error) throw error;

      setIsCorrectModalOpen(false);
      setSelectedDonation(null);
      await fetchDonations();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Correction failed.');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Submit Cancellation (Soft-Delete)
  const handleConfirmCancel = async (reason: string) => {
    if (!supabase || !selectedDonation) return;
    setIsActionLoading(true);
    setActionError(null);

    try {
      const { data, error } = await supabase.rpc('cancel_donation', {
        p_donation_id: selectedDonation.id,
        p_reason: reason,
      });

      if (error) throw error;

      setIsCancelModalOpen(false);
      setSelectedDonation(null);
      await fetchDonations();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Cancellation failed.');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Filtered List
  const filteredDonations = donations.filter((d) => {
    if (searchReceipt && !d.receipt_number.toLowerCase().includes(searchReceipt.toLowerCase())) {
      return false;
    }
    if (selectedCategoryId && d.category_id !== selectedCategoryId) {
      return false;
    }
    if (selectedAccountId && d.receiving_account_id !== selectedAccountId) {
      return false;
    }
    if (selectedPaymentMethod && d.payment_method !== selectedPaymentMethod) {
      return false;
    }
    return true;
  });

  const activeTotal = filteredDonations
    .filter((d) => !d.deleted_at)
    .reduce((sum, d) => sum + Number(d.amount), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Receipt className="w-5 h-5 text-sky-400" />
            <span>Donation Registry</span>
          </h1>
          <p className="text-xs text-slate-400">
            Authoritative financial records for{' '}
            <strong className="text-slate-200">{activeChurch?.name}</strong>
          </p>
        </div>

        {/* Summary Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl px-4 py-2.5 flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-400 block text-[10px] uppercase">Active Entries</span>
            <span className="font-bold text-white">
              {filteredDonations.filter((d) => !d.deleted_at).length}
            </span>
          </div>
          <div className="w-px h-7 bg-slate-800" />
          <div>
            <span className="text-slate-400 block text-[10px] uppercase">Filtered Total</span>
            <span className="font-bold text-emerald-400 text-sm">
              {formatINR(activeTotal)}
            </span>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Search Receipt */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchReceipt}
              onChange={(e) => setSearchReceipt(e.target.value)}
              placeholder="Search receipt number..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 font-mono"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Account Filter */}
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
          >
            <option value="">All Receiving Accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.account_name}
              </option>
            ))}
          </select>

          {/* Payment Method Filter */}
          <select
            value={selectedPaymentMethod}
            onChange={(e) => setSelectedPaymentMethod(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
          >
            <option value="">All Payment Methods</option>
            <option value="Cash">Cash</option>
            <option value="UPI">UPI</option>
            <option value="Bank Transfer">Bank Transfer</option>
            <option value="Cheque">Cheque</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {/* Toggle Cancelled Records */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs text-slate-400">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeCancelled}
              onChange={(e) => setIncludeCancelled(e.target.checked)}
              className="rounded bg-slate-950 border-slate-700 text-sky-500 focus:ring-0"
            />
            <span>Include Cancelled / Deleted records</span>
          </label>
          <span className="text-[11px] text-slate-500 font-mono">
            Cancelled records are excluded from active totals
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-medium">
                <th className="py-3 px-4 font-mono">Receipt #</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Member</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Method / Account</th>
                <th className="py-3 px-4 text-right">Amount (₹)</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    Loading church donation records...
                  </td>
                </tr>
              ) : filteredDonations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No donations match the current filter criteria.
                  </td>
                </tr>
              ) : (
                filteredDonations.map((d) => {
                  const isDeleted = Boolean(d.deleted_at);
                  return (
                    <tr
                      key={d.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isDeleted ? 'bg-red-950/10 text-slate-400' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-sky-300">
                        {d.receipt_number}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {d.donation_date}
                      </td>
                      <td className="py-3 px-4 font-medium text-white">
                        {d.member?.full_name || 'Member'}
                        <span className="block text-[10px] text-slate-500 font-mono">
                          {d.member?.member_number}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[11px] border border-slate-700">
                          {d.category?.name || 'Category'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-white font-medium">{d.payment_method}</span>
                        <span className="block text-[10px] text-slate-400">
                          {d.receiving_account?.account_name}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                        {formatINR(Number(d.amount))}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isDeleted ? (
                          <span className="bg-red-500/20 text-red-300 px-2 py-0.5 rounded text-[10px] font-mono font-bold border border-red-500/30">
                            CANCELLED
                          </span>
                        ) : (
                          <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-[10px] font-mono border border-emerald-500/20">
                            ACTIVE
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right space-x-1">
                        <button
                          onClick={() => handleOpenDetails(d)}
                          title="View Details & Revision History"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>

                        {canEditOrCancel && !isDeleted && (
                          <>
                            <button
                              onClick={() => {
                                setSelectedDonation(d);
                                handleOpenCorrect(d);
                              }}
                              title="Correct Donation (Admin / Accountant)"
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 transition-colors"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setSelectedDonation(d);
                                setIsCancelModalOpen(true);
                              }}
                              title="Cancel / Mark as Deleted"
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-red-400 hover:text-red-300 transition-colors"
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

      {/* DETAILS & REVISION HISTORY MODAL */}
      {selectedDonation && !isCorrectModalOpen && !isCancelModalOpen && (
        <Modal
          isOpen={Boolean(selectedDonation)}
          onClose={() => setSelectedDonation(null)}
          title={`Donation Details: ${selectedDonation.receipt_number}`}
          maxWidth="lg"
        >
          <div className="space-y-5 text-xs">
            {/* Primary Details */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 grid grid-cols-2 gap-3">
              <div>
                <span className="text-slate-500 block">Receipt Number</span>
                <span className="font-mono font-bold text-sky-400 text-sm">
                  {selectedDonation.receipt_number}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Donation Amount</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  {formatINR(Number(selectedDonation.amount))}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Member</span>
                <span className="text-white font-medium">
                  {selectedDonation.member?.full_name} ({selectedDonation.member?.member_number})
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Donation Date</span>
                <span className="text-slate-300 font-mono">{selectedDonation.donation_date}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Category</span>
                <span className="text-slate-300">{selectedDonation.category?.name}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Receiving Account</span>
                <span className="text-slate-300">
                  {selectedDonation.receiving_account?.account_name}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Payment Method</span>
                <span className="text-slate-300">{selectedDonation.payment_method}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Reference</span>
                <span className="text-slate-300 font-mono">
                  {selectedDonation.payment_reference || 'None'}
                </span>
              </div>
            </div>

            {/* Cancelled Banner if applicable */}
            {selectedDonation.deleted_at && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span>Cancelled Record Notice</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Cancelled on: {new Date(selectedDonation.deleted_at).toLocaleString('en-IN')}.
                  <br />
                  Reason: <em>"{selectedDonation.deletion_reason || 'No reason specified'}"</em>.
                  Receipt number remains permanently reserved in registry.
                </p>
              </div>
            )}

            {/* Revisions History */}
            <div className="space-y-2">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <History className="w-4 h-4 text-sky-400" />
                <span>Append-Only Revisions History</span>
              </h3>

              {isLoadingRevisions ? (
                <p className="text-slate-500">Loading revisions...</p>
              ) : revisions.length === 0 ? (
                <p className="text-slate-500">Initial revision record.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {revisions.map((rev) => (
                    <div
                      key={rev.id}
                      className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1 text-[11px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold text-sky-300">
                          Rev #{rev.revision_number} &bull; {rev.change_type.toUpperCase()}
                        </span>
                        <span className="text-slate-500 font-mono">
                          {new Date(rev.created_at).toLocaleString('en-IN')}
                        </span>
                      </div>
                      <p className="text-slate-400">
                        Reason: <span className="text-slate-200">{rev.reason}</span>
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions in details */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                onClick={() => setSelectedDonation(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors"
              >
                Close
              </button>

              {canEditOrCancel && !selectedDonation.deleted_at && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenCorrect(selectedDonation)}
                    className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-xl flex items-center gap-1.5 transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Correct Donation</span>
                  </button>

                  <button
                    onClick={() => setIsCancelModalOpen(true)}
                    className="px-3.5 py-2 bg-red-600 hover:bg-red-500 text-white font-medium rounded-xl flex items-center gap-1.5 transition-colors"
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

      {/* CORRECTION FORM MODAL */}
      {isCorrectModalOpen && (
        <Modal
          isOpen={isCorrectModalOpen}
          onClose={() => setIsCorrectModalOpen(false)}
          title="Correct Saved Donation (Admin / Accountant)"
          maxWidth="lg"
        >
          <form onSubmit={handleSubmitCorrection} className="space-y-4 text-xs">
            {actionError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl">
                {actionError}
              </div>
            )}

            <div className="p-3 bg-sky-500/10 border border-sky-500/20 text-sky-300 rounded-xl text-[11px] leading-relaxed">
              <strong>Audit Policy:</strong> Correcting a donation creates a permanent revision
              snapshot. If receipt number is changed, the old receipt number remains reserved forever in
              the registry and cannot be reassigned to any other donation.
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Receipt Number</label>
              <input
                type="text"
                value={editReceiptNumber}
                onChange={(e) => setEditReceiptNumber(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-sky-300 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Amount (INR)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-emerald-400 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Donation Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 font-mono text-white focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Category</label>
                <select
                  value={editCategoryId}
                  onChange={(e) => setEditCategoryId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Receiving Account</label>
                <select
                  value={editAccountId}
                  onChange={(e) => setEditAccountId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_name}
                    </option>
                  ))}
                </select>
              </div>
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
                placeholder="e.g. Corrected typo in amount from bank slip..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsCorrectModalOpen(false)}
                disabled={isActionLoading}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isActionLoading}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl transition-colors"
              >
                {isActionLoading ? 'Saving Correction...' : 'Submit Correction'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* CANCELLATION REASON MODAL */}
      <ReasonModal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        onConfirm={handleConfirmCancel}
        title="Cancel / Mark Donation as Deleted"
        description="Never permanently deleted: This donation will be marked as cancelled and excluded from active financial totals. Its receipt number remains permanently reserved."
        confirmLabel="Cancel Donation"
        isDestructive={true}
        isLoading={isActionLoading}
      />
    </div>
  );
};

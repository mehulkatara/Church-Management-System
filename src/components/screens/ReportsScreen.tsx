import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { Donation, Member, DonationCategory, ReceivingAccount } from '../../types/database';
import {
  getFinancialYearOptions,
  formatINR,
  sanitizeExcelCell,
  getFinancialYear,
} from '../../lib/domain-logic';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  FileText,
  Download,
  Filter,
  Calendar,
  Building2,
  Users,
  CheckCircle,
  AlertCircle,
  Layers,
} from 'lucide-react';

type ReportType =
  | 'member_statement'
  | 'account_transactions'
  | 'category_donations'
  | 'transaction_register'
  | 'fy_summary'
  | 'member_directory';

export const ReportsScreen: React.FC = () => {
  const { activeChurch, activeRole, isPlatformAdmin, user, profile } = useAuth();

  const isStaff = activeRole === 'admin' || activeRole === 'accountant' || isPlatformAdmin;
  const isMember = activeRole === 'member';

  const fyOptions = getFinancialYearOptions(5);
  const [selectedFy, setSelectedFy] = useState(fyOptions[0].fyCode);
  const [reportType, setReportType] = useState<ReportType>(
    isMember ? 'member_statement' : 'transaction_register'
  );

  // Filters
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Master Data & Donations
  const [donations, setDonations] = useState<Donation[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<DonationCategory[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !activeChurch) return;

    const fetchData = async () => {
      setIsLoading(true);
      try {
        // Fetch donations for active church
        let query = supabase
          .from('donations')
          .select(`
            *,
            member:members(*),
            category:donation_categories(*),
            receiving_account:receiving_accounts(*)
          `)
          .eq('church_id', activeChurch.id)
          .is('deleted_at', null)
          .order('donation_date', { ascending: true });

        // If member role: strictly scope to own records
        if (isMember && user) {
          const { data: linkData } = await supabase
            .from('member_account_links')
            .select('member_id')
            .eq('user_id', user.id)
            .eq('church_id', activeChurch.id)
            .maybeSingle();

          if (linkData) {
            query = query.eq('member_id', linkData.member_id);
            setSelectedMemberId(linkData.member_id);
          } else {
            setDonations([]);
            setIsLoading(false);
            return;
          }
        }

        const { data: donationData, error } = await query;
        if (error) throw error;
        setDonations((donationData || []) as Donation[]);

        if (isStaff) {
          const { data: memData } = await supabase
            .from('members')
            .select('*')
            .eq('church_id', activeChurch.id)
            .order('full_name');
          if (memData) setMembers(memData as Member[]);

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
        }
      } catch (err) {
        console.error('Error fetching report data:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [activeChurch, isMember, user]);

  // Filter donations by selected financial year and filters
  const currentFyInfo = fyOptions.find((f) => f.fyCode === selectedFy) || fyOptions[0];

  const filteredDonations = donations.filter((d) => {
    // FY check by donation_date (1 April to 31 March)
    if (d.donation_date < currentFyInfo.startDate || d.donation_date > currentFyInfo.endDate) {
      return false;
    }
    if (selectedMemberId && d.member_id !== selectedMemberId) return false;
    if (selectedCategoryId && d.category_id !== selectedCategoryId) return false;
    if (selectedAccountId && d.receiving_account_id !== selectedAccountId) return false;
    return true;
  });

  const totalAmount = filteredDonations.reduce((sum, d) => sum + Number(d.amount), 0);

  // 1. GENERATE REAL PDF REPORT
  const handleExportPDF = () => {
    setIsExporting(true);
    setExportMessage(null);

    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const churchName = activeChurch?.name || 'Church';
      const genDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

      // Header Banner
      doc.setFillColor(30, 41, 59); // slate-800
      doc.rect(0, 0, 210, 32, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(churchName, 14, 12);

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(203, 213, 225);
      doc.text(`Financial Report: ${getReportTitle(reportType)}`, 14, 18);
      doc.text(`Period: ${currentFyInfo.label} (${currentFyInfo.startDate} to ${currentFyInfo.endDate})`, 14, 24);

      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Generated: ${genDate} (Asia/Kolkata)`, 140, 24);

      // Reset text color for body
      doc.setTextColor(30, 41, 59);

      if (reportType === 'member_directory') {
        // Member directory table
        const directoryMembers = members.filter((m) => {
          if (statusFilter !== 'all' && m.membership_status !== statusFilter) return false;
          return true;
        });

        const tableRows = directoryMembers.map((m) => [
          m.member_number,
          m.full_name,
          m.village_name || '-',
          m.contact_phone || '-',
          m.membership_status.toUpperCase(),
        ]);

        autoTable(doc, {
          startY: 38,
          head: [['Member #', 'Full Name', 'Village', 'Phone', 'Status']],
          body: tableRows,
          theme: 'striped',
          headStyles: { fillColor: [15, 23, 42] },
          styles: { fontSize: 8 },
        });
      } else {
        // Donation tables
        const tableRows = filteredDonations.map((d) => [
          d.receipt_number,
          d.donation_date,
          d.member?.full_name || 'Member',
          d.category?.name || 'Category',
          d.payment_method,
          Number(d.amount).toFixed(2),
        ]);

        autoTable(doc, {
          startY: 38,
          head: [['Receipt #', 'Date', 'Member', 'Category', 'Method', 'Amount (INR)']],
          body: tableRows,
          theme: 'striped',
          headStyles: { fillColor: [15, 23, 42] },
          styles: { fontSize: 8 },
          foot: [['Total', '', '', '', '', Number(totalAmount).toFixed(2)]],
          footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
        });
      }

      // Page numbers footer
      const pageCount = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(
          `Page ${i} of ${pageCount} - Confidential Church Financial Record`,
          14,
          290
        );
      }

      const fileName = `${churchName.replace(/\s+/g, '_')}_${reportType}_${selectedFy}.pdf`;
      doc.save(fileName);
      setExportMessage(`Successfully generated PDF: ${fileName}`);
    } catch (err: unknown) {
      console.error('PDF export error:', err);
      setExportMessage('Failed to generate PDF statement.');
    } finally {
      setIsExporting(false);
    }
  };

  // 2. GENERATE REAL EXCEL (.xlsx) REPORT WITH INJECTION SANITIZATION
  const handleExportExcel = () => {
    setIsExporting(true);
    setExportMessage(null);

    try {
      const churchName = activeChurch?.name || 'Church';
      let exportRows: Record<string, unknown>[] = [];

      if (reportType === 'member_directory') {
        exportRows = members
          .filter((m) => statusFilter === 'all' || m.membership_status === statusFilter)
          .map((m) => ({
            'Member Number': sanitizeExcelCell(m.member_number),
            'Full Name': sanitizeExcelCell(m.full_name),
            'Village Name': sanitizeExcelCell(m.village_name || ''),
            'Contact Phone': sanitizeExcelCell(m.contact_phone || ''),
            'Contact Email': sanitizeExcelCell(m.contact_email || ''),
            'Membership Status': sanitizeExcelCell(m.membership_status.toUpperCase()),
            'Joining Date': sanitizeExcelCell(m.joining_date),
          }));
      } else {
        exportRows = filteredDonations.map((d) => ({
          // Preserve receipt number as text by wrapping or prepending
          'Receipt Number': sanitizeExcelCell(String(d.receipt_number)),
          'Donation Date': sanitizeExcelCell(d.donation_date),
          'Member Number': sanitizeExcelCell(d.member?.member_number || ''),
          'Member Name': sanitizeExcelCell(d.member?.full_name || ''),
          'Category': sanitizeExcelCell(d.category?.name || ''),
          'Amount (INR)': Number(d.amount),
          'Payment Method': sanitizeExcelCell(d.payment_method),
          'Receiving Account': sanitizeExcelCell(d.receiving_account?.account_name || ''),
          'Reference': sanitizeExcelCell(d.payment_reference || ''),
        }));
      }

      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report');

      const fileName = `${churchName.replace(/\s+/g, '_')}_${reportType}_${selectedFy}.xlsx`;
      XLSX.writeFile(wb, fileName);
      setExportMessage(`Successfully generated Excel spreadsheet: ${fileName}`);
    } catch (err: unknown) {
      console.error('Excel export error:', err);
      setExportMessage('Failed to generate Excel spreadsheet.');
    } finally {
      setIsExporting(false);
    }
  };

  function getReportTitle(type: ReportType): string {
    switch (type) {
      case 'member_statement':
        return 'Member-Wise Donation Statement';
      case 'account_transactions':
        return 'Receiving-Account Transactions';
      case 'category_donations':
        return 'Category-Wise Donations';
      case 'transaction_register':
        return 'Detailed Donation Register';
      case 'fy_summary':
        return 'Financial-Year Summary';
      case 'member_directory':
        return 'Church Member Directory';
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-sky-400" />
            <span>{isMember ? 'My Financial Statements' : 'Financial Reports & Exports'}</span>
          </h1>
          <p className="text-xs text-slate-400">
            Church: <strong className="text-slate-200">{activeChurch?.name}</strong> &bull; Indian
            Financial Year: 1 April – 31 March
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportPDF}
            disabled={isExporting || isLoading}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download PDF</span>
          </button>

          {isStaff && (
            <button
              onClick={handleExportExcel}
              disabled={isExporting || isLoading}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-emerald-600/20 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Excel (.xlsx)</span>
            </button>
          )}
        </div>
      </div>

      {/* Export notification message */}
      {exportMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{exportMessage}</span>
        </div>
      )}

      {/* Report Controls & Filters Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Report Type (Staff only) */}
          {isStaff ? (
            <div>
              <label className="block text-slate-400 font-medium mb-1">Report Type</label>
              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              >
                <option value="transaction_register">Detailed Donation Register</option>
                <option value="member_statement">Member-Wise Statement</option>
                <option value="category_donations">Category-Wise Donations</option>
                <option value="account_transactions">Receiving-Account Transactions</option>
                <option value="fy_summary">Financial-Year Summary</option>
                <option value="member_directory">Current Member Directory</option>
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-slate-400 font-medium mb-1">Report</label>
              <div className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white font-medium">
                Personal Donation Statement
              </div>
            </div>
          )}

          {/* Financial Year Selector */}
          <div>
            <label className="block text-slate-400 font-medium mb-1">Financial Year</label>
            <select
              value={selectedFy}
              onChange={(e) => setSelectedFy(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-sky-500"
            >
              {fyOptions.map((fy) => (
                <option key={fy.fyCode} value={fy.fyCode}>
                  {fy.label} ({fy.startDate} to {fy.endDate})
                </option>
              ))}
            </select>
          </div>

          {/* Member Selector (for staff if member_statement selected) */}
          {isStaff && reportType === 'member_statement' && (
            <div>
              <label className="block text-slate-400 font-medium mb-1">Member</label>
              <select
                value={selectedMemberId}
                onChange={(e) => setSelectedMemberId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">All Members</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name} ({m.member_number})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Category Filter */}
          {isStaff && (reportType === 'transaction_register' || reportType === 'category_donations') && (
            <div>
              <label className="block text-slate-400 font-medium mb-1">Category</label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Receiving Account Filter */}
          {isStaff && (reportType === 'transaction_register' || reportType === 'account_transactions') && (
            <div>
              <label className="block text-slate-400 font-medium mb-1">Receiving Account</label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">All Accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.account_name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Totals Summary */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
          <span className="text-slate-400 font-mono">
            Period: {currentFyInfo.label} &bull; Filtered Entries: {filteredDonations.length}
          </span>
          <span className="font-mono text-sm text-white">
            Total Credits: <strong className="text-emerald-400">{formatINR(totalAmount)}</strong>
          </span>
        </div>
      </div>

      {/* Preview Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-xs font-semibold text-white tracking-tight">
            Report Data Preview
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            {currentFyInfo.startDate} &rarr; {currentFyInfo.endDate}
          </span>
        </div>

        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-400 font-medium">
                <th className="py-2.5 px-4 font-mono">Receipt #</th>
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-4">Member</th>
                <th className="py-2.5 px-4">Category</th>
                <th className="py-2.5 px-4">Account / Method</th>
                <th className="py-2.5 px-4 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Loading report preview...
                  </td>
                </tr>
              ) : filteredDonations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No transactions recorded for the selected period.
                  </td>
                </tr>
              ) : (
                filteredDonations.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono font-medium text-sky-400">
                      {d.receipt_number}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-400">
                      {d.donation_date}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-white">
                      {d.member?.full_name || 'Member'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-300">
                      {d.category?.name || 'Category'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-400">
                      {d.payment_method} &bull; {d.receiving_account?.account_name}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-400">
                      {formatINR(Number(d.amount))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

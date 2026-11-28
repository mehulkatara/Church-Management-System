import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type {
  Donation,
  Expense,
  Member,
  DonationCategory,
  ExpenseCategory,
  ReceivingAccount,
} from '../../types/database';
import {
  mergeFinancialYearOptions,
  formatINR,
  sanitizeExcelCell,
  buildExpenseCategoryBreakdown,
  buildMonthlyCashFlowTrend,
} from '../../lib/domain-logic';
import { fetchAllPages } from '../../lib/supabase-pagination';
import {
  exportFinancialReportPdf,
  type PdfTableColumn,
} from '../../lib/pdf-report-renderer';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Download,
  CheckCircle,
  AlertCircle,
  Loader2,
} from 'lucide-react';

type ReportType =
  | 'member_statement'
  | 'account_transactions'
  | 'category_donations'
  | 'transaction_register'
  | 'fy_summary'
  | 'member_directory'
  | 'expense_register'
  | 'category_expenses'
  | 'income_vs_expense';

export const ReportsScreen: React.FC = () => {
  const { activeChurch, activeRole, isPlatformAdmin, user } = useAuth();

  const isStaff = activeRole === 'admin' || activeRole === 'accountant' || isPlatformAdmin;
  const isMember = activeRole === 'member';

  const [discoveredFyInputs, setDiscoveredFyInputs] = useState<string[]>([]);
  const fyOptions = useMemo(
    () => mergeFinancialYearOptions(7, discoveredFyInputs),
    [discoveredFyInputs]
  );
  const [selectedFy, setSelectedFy] = useState(() => mergeFinancialYearOptions(7, [])[0].fyCode);
  const [reportType, setReportType] = useState<ReportType>(
    isMember ? 'member_statement' : 'transaction_register'
  );

  // Filters
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [selectedExpenseCategoryId, setSelectedExpenseCategoryId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [statusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Master Data, Donations & Expenses
  const [donations, setDonations] = useState<Donation[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<DonationCategory[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [linkedMemberId, setLinkedMemberId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const currentFyInfo = useMemo(
    () => fyOptions.find((f) => f.fyCode === selectedFy) || fyOptions[0],
    [fyOptions, selectedFy]
  );

  // 1. Load church master lookups & discover earliest/latest FY dates once per church
  useEffect(() => {
    if (!supabase || !activeChurch) {
      setDiscoveredFyInputs([]);
      setMembers([]);
      setCategories([]);
      setExpenseCategories([]);
      setAccounts([]);
      setLinkedMemberId(null);
      return;
    }

    const client = supabase;
    let cancelled = false;

    const loadMasterAndFyBounds = async () => {
      try {
        let memberLinkId: string | null = null;
        if (isMember && user) {
          const { data: linkData } = await client
            .from('member_account_links')
            .select('member_id')
            .eq('user_id', user.id)
            .eq('church_id', activeChurch.id)
            .maybeSingle();

          memberLinkId = linkData?.member_id || null;
          if (!cancelled) {
            setLinkedMemberId(memberLinkId);
            setSelectedMemberId(memberLinkId || '');
          }
        } else if (!cancelled) {
          setLinkedMemberId(null);
        }

        // Discover earliest & latest donation/expense dates so every active FY appears in dropdown
        const buildDonationDateBoundQuery = (ascending: boolean) => {
          let q = client
            .from('donations')
            .select('donation_date, financial_year')
            .eq('church_id', activeChurch.id)
            .is('deleted_at', null);
          if (isMember && memberLinkId) {
            q = q.eq('member_id', memberLinkId);
          }
          return q.order('donation_date', { ascending }).limit(1);
        };

        const [{ data: minDon }, { data: maxDon }] =
          isMember && !memberLinkId
            ? [{ data: [] }, { data: [] }]
            : await Promise.all([
                buildDonationDateBoundQuery(true),
                buildDonationDateBoundQuery(false),
              ]);

        const discovered: string[] = [];
        for (const row of [...(minDon || []), ...(maxDon || [])]) {
          if (row?.donation_date) discovered.push(row.donation_date);
          if (row?.financial_year) discovered.push(row.financial_year);
        }

        if (isStaff) {
          const [
            allMembers,
            { data: catData },
            { data: expCatData },
            { data: accData },
            { data: minExp },
            { data: maxExp },
          ] = await Promise.all([
            fetchAllPages<Member>((from, to) =>
              client
                .from('members')
                .select('*')
                .eq('church_id', activeChurch.id)
                .order('full_name')
                .order('id')
                .range(from, to)
            ),
            client
              .from('donation_categories')
              .select('*')
              .eq('church_id', activeChurch.id)
              .order('name'),
            client
              .from('expense_categories')
              .select('*')
              .eq('church_id', activeChurch.id)
              .order('name'),
            client
              .from('receiving_accounts')
              .select('*')
              .eq('church_id', activeChurch.id)
              .order('account_name'),
            client
              .from('expenses')
              .select('expense_date')
              .eq('church_id', activeChurch.id)
              .is('deleted_at', null)
              .order('expense_date', { ascending: true })
              .limit(1),
            client
              .from('expenses')
              .select('expense_date')
              .eq('church_id', activeChurch.id)
              .is('deleted_at', null)
              .order('expense_date', { ascending: false })
              .limit(1),
          ]);

          for (const row of [...(minExp || []), ...(maxExp || [])]) {
            if (row?.expense_date) discovered.push(row.expense_date);
          }

          if (!cancelled) {
            setMembers(allMembers);
            setCategories((catData || []) as DonationCategory[]);
            setExpenseCategories((expCatData || []) as ExpenseCategory[]);
            setAccounts((accData || []) as ReceivingAccount[]);
          }
        }

        if (!cancelled) {
          setDiscoveredFyInputs(discovered);
        }
      } catch (err) {
        console.error('Error loading report lookups:', err);
      }
    };

    void loadMasterAndFyBounds();

    return () => {
      cancelled = true;
    };
  }, [activeChurch, isStaff, isMember, user]);

  // 2. Fetch paginated donations & expenses strictly scoped to the selected Financial Year
  useEffect(() => {
    if (!supabase || !activeChurch) {
      setIsLoading(false);
      return;
    }

    const client = supabase;
    let cancelled = false;

    const fetchFyRecords = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        let memberFilterId: string | null = linkedMemberId;
        if (isMember && user && !memberFilterId) {
          const { data: linkData } = await client
            .from('member_account_links')
            .select('member_id')
            .eq('user_id', user.id)
            .eq('church_id', activeChurch.id)
            .maybeSingle();

          memberFilterId = linkData?.member_id || null;
          if (!memberFilterId) {
            if (!cancelled) {
              setDonations([]);
              setExpenses([]);
              setIsLoading(false);
            }
            return;
          }
        }

        const donationRows = await fetchAllPages<Donation>((from, to) => {
          let query = client
            .from('donations')
            .select(`
              *,
              member:members(*),
              category:donation_categories(*),
              receiving_account:receiving_accounts(*)
            `)
            .eq('church_id', activeChurch.id)
            .is('deleted_at', null)
            .gte('donation_date', currentFyInfo.startDate)
            .lte('donation_date', currentFyInfo.endDate)
            .order('donation_date', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to);

          if (isMember && memberFilterId) {
            query = query.eq('member_id', memberFilterId);
          }

          return query;
        });

        let expenseRows: Expense[] = [];
        if (isStaff) {
          expenseRows = await fetchAllPages<Expense>((from, to) =>
            client
              .from('expenses')
              .select(`
                *,
                category:expense_categories(*),
                paid_from_account:receiving_accounts(*)
              `)
              .eq('church_id', activeChurch.id)
              .is('deleted_at', null)
              .gte('expense_date', currentFyInfo.startDate)
              .lte('expense_date', currentFyInfo.endDate)
              .order('expense_date', { ascending: true })
              .order('id', { ascending: true })
              .range(from, to)
          );
        }

        if (!cancelled) {
          setDonations(donationRows);
          setExpenses(expenseRows);
        }
      } catch (err) {
        console.error('Error fetching report data:', err);
        if (!cancelled) {
          setLoadError('Unable to load financial records for the selected financial year.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchFyRecords();

    return () => {
      cancelled = true;
    };
  }, [
    activeChurch,
    isStaff,
    isMember,
    user,
    linkedMemberId,
    currentFyInfo.startDate,
    currentFyInfo.endDate,
  ]);

  const fyDonations = useMemo(
    () =>
      donations.filter(
        (d) =>
          d.donation_date >= currentFyInfo.startDate &&
          d.donation_date <= currentFyInfo.endDate
      ),
    [donations, currentFyInfo.startDate, currentFyInfo.endDate]
  );

  const filteredDonations = useMemo(
    () =>
      fyDonations.filter((d) => {
        if (selectedMemberId && d.member_id !== selectedMemberId) return false;
        if (selectedCategoryId && d.category_id !== selectedCategoryId) return false;
        if (selectedAccountId && d.receiving_account_id !== selectedAccountId) return false;
        return true;
      }),
    [fyDonations, selectedMemberId, selectedCategoryId, selectedAccountId]
  );

  const fyExpenses = useMemo(
    () =>
      expenses.filter(
        (e) =>
          e.expense_date >= currentFyInfo.startDate &&
          e.expense_date <= currentFyInfo.endDate
      ),
    [expenses, currentFyInfo.startDate, currentFyInfo.endDate]
  );

  const filteredExpenses = useMemo(
    () =>
      fyExpenses.filter((e) => {
        if (selectedExpenseCategoryId && e.category_id !== selectedExpenseCategoryId) return false;
        if (selectedAccountId && e.paid_from_account_id !== selectedAccountId) return false;
        return true;
      }),
    [fyExpenses, selectedExpenseCategoryId, selectedAccountId]
  );

  const expenseCategorySummary = useMemo(
    () => buildExpenseCategoryBreakdown(filteredExpenses),
    [filteredExpenses]
  );

  const incomeVsExpenseMonthly = useMemo(
    () => buildMonthlyCashFlowTrend(fyDonations, fyExpenses, currentFyInfo.startYear),
    [fyDonations, fyExpenses, currentFyInfo.startYear]
  );

  const totalDonationAmount = useMemo(
    () => filteredDonations.reduce((sum, d) => sum + Number(d.amount), 0),
    [filteredDonations]
  );

  const totalExpenseAmount = useMemo(
    () => filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0),
    [filteredExpenses]
  );

  const totalFyCollections = useMemo(
    () => fyDonations.reduce((sum, d) => sum + Number(d.amount), 0),
    [fyDonations]
  );

  const totalFyExpenses = useMemo(
    () => fyExpenses.reduce((sum, e) => sum + Number(e.amount), 0),
    [fyExpenses]
  );

  const directoryMembers = useMemo(
    () =>
      members.filter((m) =>
        statusFilter === 'all' ? true : m.membership_status === statusFilter
      ),
    [members, statusFilter]
  );

  const isExpenseMode =
    reportType === 'expense_register' ||
    reportType === 'category_expenses' ||
    reportType === 'income_vs_expense';

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
      case 'expense_register':
        return 'Detailed Expense Register';
      case 'category_expenses':
        return 'Category-Wise Expenses';
      case 'income_vs_expense':
        return 'Income vs. Expense Summary';
    }
  }

  // 1. GENERATE REAL PDF REPORT WITH FULL GUJARATI OPENTYPE SHAPING
  const handleExportPDF = async () => {
    setIsExporting(true);
    setExportMessage(null);

    try {
      const churchName = activeChurch?.name || 'Church';
      const genDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

      let columns: PdfTableColumn[] = [];
      let rows: string[][] = [];
      let footerRow: string[] | undefined;

      if (reportType === 'member_directory') {
        columns = [
          { header: 'Member #', widthMm: 28, align: 'left' },
          { header: 'Full Name', widthMm: 62, align: 'left' },
          { header: 'Village', widthMm: 44, align: 'left' },
          { header: 'Phone', widthMm: 30, align: 'left' },
          { header: 'Status', widthMm: 22, align: 'center' },
        ];
        rows = directoryMembers.map((m) => [
          m.member_number,
          m.full_name,
          m.village_name || '-',
          m.contact_phone || '-',
          m.membership_status.toUpperCase(),
        ]);
      } else if (reportType === 'expense_register') {
        columns = [
          { header: 'Date', widthMm: 23, align: 'left' },
          { header: 'Payee', widthMm: 42, align: 'left' },
          { header: 'Bill Ref', widthMm: 25, align: 'left' },
          { header: 'Category', widthMm: 34, align: 'left' },
          { header: 'Paid From', widthMm: 36, align: 'left' },
          { header: 'Amount (INR)', widthMm: 26, align: 'right' },
        ];
        rows = filteredExpenses.map((e) => [
          e.expense_date,
          e.payee_name,
          e.bill_reference || '-',
          e.category?.name || 'Category',
          `${e.payment_method} (${e.paid_from_account?.account_name || 'Account'})`,
          Number(e.amount).toFixed(2),
        ]);
        footerRow = ['Total Expenses', '', '', '', '', Number(totalExpenseAmount).toFixed(2)];
      } else if (reportType === 'category_expenses') {
        columns = [
          { header: 'Expense Category', widthMm: 92, align: 'left' },
          { header: 'Payments', widthMm: 28, align: 'right' },
          { header: 'Share', widthMm: 28, align: 'right' },
          { header: 'Total Amount (INR)', widthMm: 38, align: 'right' },
        ];
        rows = expenseCategorySummary.map((c) => [
          c.categoryName,
          String(c.entryCount),
          `${c.percentage.toFixed(1)}%`,
          Number(c.totalAmount).toFixed(2),
        ]);
        footerRow = [
          'Total Expenses',
          String(filteredExpenses.length),
          '100.0%',
          Number(totalExpenseAmount).toFixed(2),
        ];
      } else if (reportType === 'income_vs_expense') {
        columns = [
          { header: 'Month', widthMm: 46, align: 'left' },
          { header: 'Receipts', widthMm: 22, align: 'right' },
          { header: 'Collections (INR)', widthMm: 34, align: 'right' },
          { header: 'Payments', widthMm: 22, align: 'right' },
          { header: 'Expenses (INR)', widthMm: 31, align: 'right' },
          { header: 'Net Balance (INR)', widthMm: 31, align: 'right' },
        ];
        rows = incomeVsExpenseMonthly.map((m) => [
          m.fullLabel,
          String(m.donationCount),
          Number(m.collectionsAmount).toFixed(2),
          String(m.expenseCount),
          Number(m.expensesAmount).toFixed(2),
          Number(m.netAmount).toFixed(2),
        ]);
        footerRow = [
          'FY Total',
          String(fyDonations.length),
          Number(totalFyCollections).toFixed(2),
          String(fyExpenses.length),
          Number(totalFyExpenses).toFixed(2),
          Number(totalFyCollections - totalFyExpenses).toFixed(2),
        ];
      } else {
        columns = [
          { header: 'Receipt #', widthMm: 33, align: 'left' },
          { header: 'Date', widthMm: 22, align: 'left' },
          { header: 'Member', widthMm: 48, align: 'left' },
          { header: 'Category', widthMm: 36, align: 'left' },
          { header: 'Method', widthMm: 22, align: 'left' },
          { header: 'Amount (INR)', widthMm: 25, align: 'right' },
        ];
        rows = filteredDonations.map((d) => [
          d.receipt_number,
          d.donation_date,
          d.member?.full_name || 'Member',
          d.category?.name || 'Category',
          d.payment_method,
          Number(d.amount).toFixed(2),
        ]);
        footerRow = ['Total', '', '', '', '', Number(totalDonationAmount).toFixed(2)];
      }

      const fileName = `${churchName.replace(/\s+/g, '_')}_${reportType}_${selectedFy}.pdf`;

      await exportFinancialReportPdf({
        churchName,
        reportTitle: getReportTitle(reportType),
        periodLabel: `${currentFyInfo.label} (${currentFyInfo.startDate} to ${currentFyInfo.endDate})`,
        generatedAt: genDate,
        columns,
        rows,
        footerRow,
        fileName,
      });

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
        exportRows = directoryMembers.map((m) => ({
          'Member Number': sanitizeExcelCell(m.member_number),
          'Full Name': sanitizeExcelCell(m.full_name),
          'Village Name': sanitizeExcelCell(m.village_name || ''),
          'Contact Phone': sanitizeExcelCell(m.contact_phone || ''),
          'Membership Status': sanitizeExcelCell(m.membership_status.toUpperCase()),
          'Joining Date': sanitizeExcelCell(m.joining_date),
        }));
      } else if (reportType === 'expense_register') {
        exportRows = filteredExpenses.map((e) => ({
          'Expense Date': sanitizeExcelCell(e.expense_date),
          'Payee / Vendor': sanitizeExcelCell(e.payee_name),
          'Bill / Voucher Ref': sanitizeExcelCell(e.bill_reference || ''),
          'Expense Category': sanitizeExcelCell(e.category?.name || ''),
          'Amount (INR)': Number(e.amount),
          'Payment Method': sanitizeExcelCell(e.payment_method),
          'Paid-From Account': sanitizeExcelCell(e.paid_from_account?.account_name || ''),
          'Notes': sanitizeExcelCell(e.notes || ''),
        }));
      } else if (reportType === 'category_expenses') {
        exportRows = expenseCategorySummary.map((c) => ({
          'Expense Category': sanitizeExcelCell(c.categoryName),
          'Payment Entries': Number(c.entryCount),
          'Share (%)': Number(c.percentage.toFixed(1)),
          'Total Amount (INR)': Number(c.totalAmount),
        }));
      } else if (reportType === 'income_vs_expense') {
        exportRows = incomeVsExpenseMonthly.map((m) => ({
          'Month': sanitizeExcelCell(m.fullLabel),
          'Valid Receipts': Number(m.donationCount),
          'Collections (INR)': Number(m.collectionsAmount),
          'Expense Payments': Number(m.expenseCount),
          'Expenses (INR)': Number(m.expensesAmount),
          'Net Balance (INR)': Number(m.netAmount),
        }));
        exportRows.push({
          'Month': sanitizeExcelCell(`FY ${currentFyInfo.fyCode} Total`),
          'Valid Receipts': Number(fyDonations.length),
          'Collections (INR)': Number(totalFyCollections),
          'Expense Payments': Number(fyExpenses.length),
          'Expenses (INR)': Number(totalFyExpenses),
          'Net Balance (INR)': Number(totalFyCollections - totalFyExpenses),
        });
      } else {
        exportRows = filteredDonations.map((d) => ({
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
            type="button"
            onClick={() => void handleExportPDF()}
            disabled={isExporting || isLoading}
            className="bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer whitespace-nowrap"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{isExporting ? 'Generating PDF...' : 'Download PDF'}</span>
          </button>

          {isStaff && (
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={isExporting || isLoading}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold text-xs py-2 px-3.5 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-emerald-600/20 cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Export Excel (.xlsx)</span>
            </button>
          )}
        </div>
      </div>

      {/* Load error alert */}
      {loadError && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

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
          {/* Report Type (Admin / Accountant only) */}
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
                <option value="expense_register">Detailed Expense Register</option>
                <option value="category_expenses">Category-Wise Expenses</option>
                <option value="income_vs_expense">Income vs. Expense Summary</option>
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

          {/* Member Selector */}
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

          {/* Donation Category Filter */}
          {isStaff && (reportType === 'transaction_register' || reportType === 'category_donations') && (
            <div>
              <label className="block text-slate-400 font-medium mb-1">Donation Category</label>
              <select
                value={selectedCategoryId}
                onChange={(e) => setSelectedCategoryId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-sky-500"
              >
                <option value="">All Donation Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Expense Category Filter */}
          {isStaff && (reportType === 'expense_register' || reportType === 'category_expenses') && (
            <div>
              <label className="block text-slate-400 font-medium mb-1">Expense Category</label>
              <select
                value={selectedExpenseCategoryId}
                onChange={(e) => setSelectedExpenseCategoryId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-500"
              >
                <option value="">All Expense Categories</option>
                {expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Cash / Bank Account Filter */}
          {isStaff &&
            (reportType === 'transaction_register' ||
              reportType === 'account_transactions' ||
              reportType === 'expense_register') && (
              <div>
                <label className="block text-slate-400 font-medium mb-1">
                  {reportType === 'expense_register' ? 'Paid-From Account' : 'Receiving Account'}
                </label>
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
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800 text-xs">
          {reportType === 'member_directory' ? (
            <>
              <span className="text-slate-400 font-mono">
                Church Member Directory
              </span>
              <span className="font-mono text-sm text-white">
                Members: <strong className="text-sky-400">{directoryMembers.length}</strong>
              </span>
            </>
          ) : reportType === 'income_vs_expense' ? (
            <>
              <span className="text-slate-400 font-mono tabular-nums">
                Collections: <strong className="text-emerald-400">{formatINR(totalFyCollections)}</strong>{' '}
                &bull; Expenses: <strong className="text-amber-400">{formatINR(totalFyExpenses)}</strong>
              </span>
              <span className="font-mono tabular-nums text-sm text-white">
                Net Balance:{' '}
                <strong
                  className={
                    totalFyCollections - totalFyExpenses >= 0 ? 'text-sky-400' : 'text-rose-400'
                  }
                >
                  {formatINR(totalFyCollections - totalFyExpenses)}
                </strong>
              </span>
            </>
          ) : isExpenseMode ? (
            <>
              <span className="text-slate-400 font-mono tabular-nums">
                Period: {currentFyInfo.label} &bull; Filtered Payments: {filteredExpenses.length}
              </span>
              <span className="font-mono tabular-nums text-sm text-white">
                Total Expenses: <strong className="text-amber-400">{formatINR(totalExpenseAmount)}</strong>
              </span>
            </>
          ) : (
            <>
              <span className="text-slate-400 font-mono tabular-nums">
                Period: {currentFyInfo.label} &bull; Filtered Entries: {filteredDonations.length}
              </span>
              <span className="font-mono tabular-nums text-sm text-white">
                Total Credits: <strong className="text-emerald-400">{formatINR(totalDonationAmount)}</strong>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Preview Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-5 py-3 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-xs font-semibold text-white tracking-tight">
            {getReportTitle(reportType)} Preview
          </span>
          <span className="text-[11px] text-slate-400 font-mono tabular-nums">
            {currentFyInfo.startDate} &rarr; {currentFyInfo.endDate}
          </span>
        </div>

        <div className="overflow-x-auto max-h-96">
          {reportType === 'member_directory' ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-400 font-medium">
                  <th className="py-2.5 px-4 font-mono">Member #</th>
                  <th className="py-2.5 px-4">Full Name</th>
                  <th className="py-2.5 px-4">Village</th>
                  <th className="py-2.5 px-4">Phone</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      Loading report preview...
                    </td>
                  </tr>
                ) : directoryMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No members found.
                    </td>
                  </tr>
                ) : (
                  directoryMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono text-sky-400">{m.member_number}</td>
                      <td className="py-2.5 px-4 font-medium text-white">{m.full_name}</td>
                      <td className="py-2.5 px-4 text-slate-300">{m.village_name || '—'}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-400">{m.contact_phone || '—'}</td>
                      <td className="py-2.5 px-4 text-center font-mono text-[11px] font-semibold">
                        <span className={m.membership_status === 'active' ? 'text-emerald-400' : 'text-slate-500'}>
                          {m.membership_status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : reportType === 'expense_register' ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-400 font-medium">
                  <th className="py-2.5 px-4">Date</th>
                  <th className="py-2.5 px-4">Payee</th>
                  <th className="py-2.5 px-4 font-mono">Bill Ref</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4">Method / Paid From</th>
                  <th className="py-2.5 px-4 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Loading expense preview...
                    </td>
                  </tr>
                ) : filteredExpenses.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No expenses recorded for the selected period.
                    </td>
                  </tr>
                ) : (
                  filteredExpenses.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">{e.expense_date}</td>
                      <td className="py-2.5 px-4 font-medium text-white">{e.payee_name}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-400">{e.bill_reference || '—'}</td>
                      <td className="py-2.5 px-4 text-slate-300">{e.category?.name || 'Category'}</td>
                      <td className="py-2.5 px-4 text-slate-400">
                        {e.payment_method} &bull; {e.paid_from_account?.account_name || 'Account'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-amber-400">
                        {formatINR(Number(e.amount))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : reportType === 'category_expenses' ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-400 font-medium">
                  <th className="py-2.5 px-4">Expense Category</th>
                  <th className="py-2.5 px-4 text-right">Payments</th>
                  <th className="py-2.5 px-4 text-right">Share</th>
                  <th className="py-2.5 px-4 text-right">Total Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {isLoading ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      Loading category summary...
                    </td>
                  </tr>
                ) : expenseCategorySummary.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      No expenses recorded for the selected period.
                    </td>
                  </tr>
                ) : (
                  expenseCategorySummary.map((c) => (
                    <tr key={c.categoryName} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-medium text-white">{c.categoryName}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-400">
                        {c.entryCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300">
                        {c.percentage.toFixed(1)}%
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-amber-400">
                        {formatINR(c.totalAmount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : reportType === 'income_vs_expense' ? (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-400 font-medium">
                  <th className="py-2.5 px-4">Month</th>
                  <th className="py-2.5 px-4 text-right">Receipts</th>
                  <th className="py-2.5 px-4 text-right">Collections (₹)</th>
                  <th className="py-2.5 px-4 text-right">Payments</th>
                  <th className="py-2.5 px-4 text-right">Expenses (₹)</th>
                  <th className="py-2.5 px-4 text-right">Net Balance (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Loading cash-flow summary...
                    </td>
                  </tr>
                ) : (
                  incomeVsExpenseMonthly.map((m) => (
                    <tr key={m.monthKey} className="hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-mono text-white">{m.fullLabel}</td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-400">
                        {m.donationCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-emerald-400">
                        {formatINR(m.collectionsAmount)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-400">
                        {m.expenseCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-amber-400">
                        {formatINR(m.expensesAmount)}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono tabular-nums font-bold ${
                          m.netAmount >= 0 ? 'text-sky-400' : 'text-rose-400'
                        }`}
                      >
                        {formatINR(m.netAmount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
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
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">
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
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-emerald-400">
                        {formatINR(Number(d.amount))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};


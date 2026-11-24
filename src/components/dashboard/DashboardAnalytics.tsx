import React, { useState } from 'react';
import {
  formatINR,
  formatCompactINR,
  type MonthlyFyTrendPoint,
  type CategoryBreakdownItem,
  type MonthlyCashFlowPoint,
  type ExpenseCategoryBreakdownItem,
} from '../../lib/domain-logic';
import { BarChart3, PieChart, PlusCircle, ArrowLeftRight, Wallet } from 'lucide-react';

type AnalyticsMode = 'collections' | 'expenses' | 'cashflow';

interface DashboardAnalyticsProps {
  fyLabel: string;
  isMember: boolean;
  isLoading: boolean;
  monthlyTrend: MonthlyFyTrendPoint[];
  categoryBreakdown: CategoryBreakdownItem[];
  onRecordDonation?: () => void;
  canViewExpenses?: boolean;
  monthlyCashFlow?: MonthlyCashFlowPoint[];
  expenseCategoryBreakdown?: ExpenseCategoryBreakdownItem[];
  onOpenExpenses?: () => void;
}

const COLLECTION_BAR_CLASSES = [
  'bg-sky-500',
  'bg-emerald-500',
  'bg-cyan-400',
  'bg-teal-400',
  'bg-indigo-400',
  'bg-amber-400',
];

const EXPENSE_BAR_CLASSES = [
  'bg-amber-500',
  'bg-rose-500',
  'bg-orange-400',
  'bg-yellow-400',
  'bg-pink-400',
  'bg-red-400',
];

export const DashboardAnalytics: React.FC<DashboardAnalyticsProps> = ({
  fyLabel,
  isMember,
  isLoading,
  monthlyTrend,
  categoryBreakdown,
  onRecordDonation,
  canViewExpenses = false,
  monthlyCashFlow = [],
  expenseCategoryBreakdown = [],
  onOpenExpenses,
}) => {
  const [viewMode, setViewMode] = useState<AnalyticsMode>('collections');
  const [activeMonthKey, setActiveMonthKey] = useState<string | null>(null);
  const [activeCategoryName, setActiveCategoryName] = useState<string | null>(null);

  const effectiveMode: AnalyticsMode = canViewExpenses ? viewMode : 'collections';

  const totalCollections = categoryBreakdown.reduce((sum, item) => sum + item.totalAmount, 0);
  const totalReceipts = categoryBreakdown.reduce((sum, item) => sum + item.receiptCount, 0);

  const totalExpenses = expenseCategoryBreakdown.reduce((sum, item) => sum + item.totalAmount, 0);
  const totalExpenseEntries = expenseCategoryBreakdown.reduce((sum, item) => sum + item.entryCount, 0);

  const activeCategoryList =
    effectiveMode === 'expenses'
      ? expenseCategoryBreakdown.map((item) => ({
          categoryName: item.categoryName,
          totalAmount: item.totalAmount,
          count: item.entryCount,
          percentage: item.percentage,
        }))
      : categoryBreakdown.map((item) => ({
          categoryName: item.categoryName,
          totalAmount: item.totalAmount,
          count: item.receiptCount,
          percentage: item.percentage,
        }));

  const maxMonthlyValue =
    effectiveMode === 'expenses'
      ? Math.max(...monthlyCashFlow.map((m) => m.expensesAmount), 0)
      : effectiveMode === 'cashflow'
      ? Math.max(
          ...monthlyCashFlow.map((m) => Math.max(m.collectionsAmount, m.expensesAmount)),
          0
        )
      : Math.max(...monthlyTrend.map((m) => m.totalAmount), 0);

  const yAxisMax = maxMonthlyValue > 0 ? maxMonthlyValue * 1.15 : 1000;

  // Focused month summary
  const cashFlowByMonth = new Map(monthlyCashFlow.map((p) => [p.monthKey, p]));
  const currentMonthDonation = monthlyTrend.find((m) => m.isCurrentMonth) || monthlyTrend[0] || null;
  const peakCollectionMonth = monthlyTrend.reduce<MonthlyFyTrendPoint | null>((best, curr) => {
    if (!best || curr.totalAmount > best.totalAmount) return curr;
    return best;
  }, null);

  const peakExpenseMonth = monthlyCashFlow.reduce<MonthlyCashFlowPoint | null>((best, curr) => {
    if (!best || curr.expensesAmount > best.expensesAmount) return curr;
    return best;
  }, null);

  const inspectedMonthKey =
    activeMonthKey ||
    (effectiveMode === 'expenses'
      ? (monthlyCashFlow.find((m) => m.isCurrentMonth && m.expensesAmount > 0)?.monthKey ||
          peakExpenseMonth?.monthKey ||
          monthlyCashFlow[0]?.monthKey ||
          null)
      : effectiveMode === 'cashflow'
      ? (monthlyCashFlow.find(
          (m) => m.isCurrentMonth && (m.collectionsAmount > 0 || m.expensesAmount > 0)
        )?.monthKey ||
          monthlyCashFlow.find((m) => m.collectionsAmount > 0 || m.expensesAmount > 0)?.monthKey ||
          monthlyCashFlow[0]?.monthKey ||
          null)
      : (currentMonthDonation && currentMonthDonation.totalAmount > 0
          ? currentMonthDonation.monthKey
          : peakCollectionMonth?.monthKey || null));

  const inspectedDonationPoint = monthlyTrend.find((m) => m.monthKey === inspectedMonthKey) || null;
  const inspectedCashFlowPoint = inspectedMonthKey
    ? cashFlowByMonth.get(inspectedMonthKey) || null
    : null;

  const inspectedCategory =
    activeCategoryList.find((c) => c.categoryName === activeCategoryName) ||
    activeCategoryList[0] ||
    null;

  // SVG coordinate space
  const chartWidth = 600;
  const chartHeight = 220;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 32;
  const plotWidth = chartWidth - padLeft - padRight;
  const plotHeight = chartHeight - padTop - padBottom;
  const monthCount =
    effectiveMode === 'collections' ? Math.max(monthlyTrend.length, 1) : Math.max(monthlyCashFlow.length, 1);
  const slotWidth = plotWidth / monthCount;
  const barWidth = Math.min(28, slotWidth * 0.58);
  const dualBarWidth = Math.min(13, slotWidth * 0.34);

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const barPalette = effectiveMode === 'expenses' ? EXPENSE_BAR_CLASSES : COLLECTION_BAR_CLASSES;
  const netFyBalance = totalCollections - totalExpenses;

  return (
    <section aria-label="Financial Year Analytics" className="space-y-4">
      {canViewExpenses && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-400 font-medium">
            {effectiveMode === 'collections'
              ? 'Viewing incoming donation trends & categories'
              : effectiveMode === 'expenses'
              ? 'Viewing outgoing church expenses & categories'
              : 'Comparing monthly collections against church expenses'}
          </div>
          <div
            role="tablist"
            aria-label="Analytics View Mode"
            className="inline-flex bg-slate-900 border border-slate-800 rounded-xl p-1 gap-1 text-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={effectiveMode === 'collections'}
              onClick={() => {
                setViewMode('collections');
                setActiveMonthKey(null);
                setActiveCategoryName(null);
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                effectiveMode === 'collections'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Collections
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveMode === 'expenses'}
              onClick={() => {
                setViewMode('expenses');
                setActiveMonthKey(null);
                setActiveCategoryName(null);
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                effectiveMode === 'expenses'
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Expenses
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={effectiveMode === 'cashflow'}
              onClick={() => {
                setViewMode('cashflow');
                setActiveMonthKey(null);
                setActiveCategoryName(null);
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                effectiveMode === 'cashflow'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Net Cash Flow
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 1. Left Chart Card (12-Month Apr - Mar Trend) */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-white font-semibold text-sm tracking-tight">
                {effectiveMode === 'cashflow' ? (
                  <ArrowLeftRight className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : effectiveMode === 'expenses' ? (
                  <Wallet className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <BarChart3 className="w-4 h-4 text-sky-400 shrink-0" />
                )}
                <h2>
                  {isMember
                    ? 'My Monthly Giving Trend'
                    : effectiveMode === 'expenses'
                    ? 'Monthly Expenses Trend'
                    : effectiveMode === 'cashflow'
                    ? 'Monthly Collections vs. Expenses'
                    : 'Monthly Collections Trend'}
                </h2>
              </div>
              <p className="text-xs text-slate-400">
                {fyLabel} · Apr to Mar{' '}
                {effectiveMode === 'expenses'
                  ? 'active payments'
                  : effectiveMode === 'cashflow'
                  ? 'cash-flow comparison'
                  : 'valid receipts'}
              </p>
            </div>

            {!isLoading && maxMonthlyValue > 0 && (
              <>
                {effectiveMode === 'collections' && inspectedDonationPoint && (
                  <div className="text-left sm:text-right">
                    <div className="text-[11px] text-slate-400 font-mono">
                      {inspectedDonationPoint.fullLabel}
                      {inspectedDonationPoint.isCurrentMonth ? ' (Current Month)' : ''}
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-sky-400">
                      {formatINR(inspectedDonationPoint.totalAmount)}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {inspectedDonationPoint.receiptCount} receipt
                      {inspectedDonationPoint.receiptCount === 1 ? '' : 's'}
                    </div>
                  </div>
                )}

                {effectiveMode === 'expenses' && inspectedCashFlowPoint && (
                  <div className="text-left sm:text-right">
                    <div className="text-[11px] text-slate-400 font-mono">
                      {inspectedCashFlowPoint.fullLabel}
                      {inspectedCashFlowPoint.isCurrentMonth ? ' (Current Month)' : ''}
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-amber-400">
                      {formatINR(inspectedCashFlowPoint.expensesAmount)}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {inspectedCashFlowPoint.expenseCount} payment
                      {inspectedCashFlowPoint.expenseCount === 1 ? '' : 's'}
                    </div>
                  </div>
                )}

                {effectiveMode === 'cashflow' && inspectedCashFlowPoint && (
                  <div className="text-left sm:text-right">
                    <div className="text-[11px] text-slate-400 font-mono">
                      {inspectedCashFlowPoint.fullLabel}
                    </div>
                    <div className="text-xs font-mono tabular-nums text-slate-200">
                      <span className="text-emerald-400">
                        +{formatINR(inspectedCashFlowPoint.collectionsAmount)}
                      </span>{' '}
                      <span aria-hidden="true">·</span>{' '}
                      <span className="text-amber-400">
                        -{formatINR(inspectedCashFlowPoint.expensesAmount)}
                      </span>
                    </div>
                    <div
                      className={`text-[11px] font-mono tabular-nums font-semibold ${
                        inspectedCashFlowPoint.netAmount >= 0 ? 'text-sky-400' : 'text-rose-400'
                      }`}
                    >
                      Net: {formatINR(inspectedCashFlowPoint.netAmount)}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {isLoading ? (
            <div className="h-[220px] flex items-end gap-2 px-2 pb-4 pt-6 animate-pulse">
              {Array.from({ length: 12 }).map((_, idx) => (
                <div
                  key={idx}
                  className="flex-1 bg-slate-800/80 rounded-t-md"
                  style={{ height: `${28 + ((idx * 19) % 62)}%` }}
                />
              ))}
            </div>
          ) : maxMonthlyValue === 0 ? (
            <div className="h-[220px] flex flex-col items-center justify-center text-center px-4 space-y-3">
              <p className="text-xs text-slate-400 max-w-sm">
                {effectiveMode === 'expenses'
                  ? `No active church expenses recorded for ${fyLabel} yet. Monthly outflow bars will appear here as expenses are saved.`
                  : isMember
                  ? `No contributions recorded for ${fyLabel} yet. Monthly totals from April to March will chart here automatically.`
                  : `No valid donations recorded for ${fyLabel} yet. Monthly collection bars will appear here as receipts are saved.`}
              </p>
              {effectiveMode === 'expenses' && onOpenExpenses && (
                <button
                  type="button"
                  onClick={onOpenExpenses}
                  className="bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  <span>Open Expenses</span>
                </button>
              )}
              {effectiveMode !== 'expenses' && !isMember && onRecordDonation && (
                <button
                  type="button"
                  onClick={onRecordDonation}
                  className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Record First Donation</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  role="img"
                  aria-label={`Monthly ${effectiveMode} trend for ${fyLabel}`}
                  className="w-full min-w-[460px] h-[220px] select-none"
                  onMouseLeave={() => setActiveMonthKey(null)}
                >
                  {yTicks.map((ratio) => {
                    const y = padTop + plotHeight * (1 - ratio);
                    const tickValue = yAxisMax * ratio;
                    return (
                      <g key={ratio}>
                        <line
                          x1={padLeft}
                          y1={y}
                          x2={chartWidth - padRight}
                          y2={y}
                          stroke={ratio === 0 ? '#334155' : '#1e293b'}
                          strokeDasharray={ratio === 0 ? undefined : '3 3'}
                          strokeWidth={1}
                        />
                        <text
                          x={padLeft - 8}
                          y={y + 4}
                          textAnchor="end"
                          fill="#94a3b8"
                          fontSize="10"
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                        >
                          {formatCompactINR(tickValue)}
                        </text>
                      </g>
                    );
                  })}

                  {effectiveMode === 'cashflow'
                    ? monthlyCashFlow.map((point, index) => {
                        const cx = padLeft + slotWidth * index + slotWidth / 2;
                        const colH =
                          point.collectionsAmount > 0
                            ? Math.max(4, (point.collectionsAmount / yAxisMax) * plotHeight)
                            : 0;
                        const expH =
                          point.expensesAmount > 0
                            ? Math.max(4, (point.expensesAmount / yAxisMax) * plotHeight)
                            : 0;
                        const isFocused = inspectedMonthKey === point.monthKey;

                        return (
                          <g
                            key={point.monthKey}
                            tabIndex={0}
                            role="button"
                            aria-label={`${point.fullLabel}: Collections ${formatINR(point.collectionsAmount)}, Expenses ${formatINR(point.expensesAmount)}`}
                            className="cursor-pointer outline-none"
                            onMouseEnter={() => setActiveMonthKey(point.monthKey)}
                            onFocus={() => setActiveMonthKey(point.monthKey)}
                            onClick={() => setActiveMonthKey(point.monthKey)}
                          >
                            <rect
                              x={padLeft + slotWidth * index}
                              y={padTop}
                              width={slotWidth}
                              height={plotHeight + padBottom}
                              fill="transparent"
                            />

                            {colH > 0 ? (
                              <rect
                                x={cx - dualBarWidth - 1.5}
                                y={padTop + plotHeight - colH}
                                width={dualBarWidth}
                                height={colH}
                                rx={3}
                                fill={isFocused ? '#34d399' : '#10b981'}
                                opacity={activeMonthKey && !isFocused ? 0.5 : 1}
                              />
                            ) : (
                              <rect
                                x={cx - dualBarWidth - 1.5}
                                y={padTop + plotHeight - 2}
                                width={dualBarWidth}
                                height={2}
                                rx={1}
                                fill="#1e293b"
                              />
                            )}

                            {expH > 0 ? (
                              <rect
                                x={cx + 1.5}
                                y={padTop + plotHeight - expH}
                                width={dualBarWidth}
                                height={expH}
                                rx={3}
                                fill={isFocused ? '#fbbf24' : '#d97706'}
                                opacity={activeMonthKey && !isFocused ? 0.5 : 1}
                              />
                            ) : (
                              <rect
                                x={cx + 1.5}
                                y={padTop + plotHeight - 2}
                                width={dualBarWidth}
                                height={2}
                                rx={1}
                                fill="#1e293b"
                              />
                            )}

                            <text
                              x={cx}
                              y={chartHeight - 10}
                              textAnchor="middle"
                              fill={
                                isFocused
                                  ? '#f8fafc'
                                  : point.isCurrentMonth
                                  ? '#34d399'
                                  : '#94a3b8'
                              }
                              fontWeight={isFocused || point.isCurrentMonth ? 600 : 400}
                              fontSize="11"
                              fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                            >
                              {point.shortLabel}
                            </text>
                          </g>
                        );
                      })
                    : (effectiveMode === 'expenses'
                        ? monthlyCashFlow.map((m) => ({
                            monthKey: m.monthKey,
                            shortLabel: m.shortLabel,
                            fullLabel: m.fullLabel,
                            totalAmount: m.expensesAmount,
                            count: m.expenseCount,
                            isCurrentMonth: m.isCurrentMonth,
                          }))
                        : monthlyTrend.map((m) => ({
                            monthKey: m.monthKey,
                            shortLabel: m.shortLabel,
                            fullLabel: m.fullLabel,
                            totalAmount: m.totalAmount,
                            count: m.receiptCount,
                            isCurrentMonth: m.isCurrentMonth,
                          }))
                      ).map((point, index) => {
                        const cx = padLeft + slotWidth * index + slotWidth / 2;
                        const x = cx - barWidth / 2;
                        const barHeight =
                          point.totalAmount > 0
                            ? Math.max(4, (point.totalAmount / yAxisMax) * plotHeight)
                            : 0;
                        const y = padTop + plotHeight - barHeight;
                        const isFocused = inspectedMonthKey === point.monthKey;

                        const fillColor =
                          point.totalAmount === 0
                            ? '#1e293b'
                            : effectiveMode === 'expenses'
                            ? isFocused
                              ? '#fbbf24'
                              : point.isCurrentMonth
                              ? '#f43f5e'
                              : '#d97706'
                            : isFocused
                            ? '#38bdf8'
                            : point.isCurrentMonth
                            ? '#10b981'
                            : '#0284c7';

                        return (
                          <g
                            key={point.monthKey}
                            tabIndex={0}
                            role="button"
                            aria-label={`${point.fullLabel}: ${formatINR(point.totalAmount)}`}
                            className="cursor-pointer outline-none"
                            onMouseEnter={() => setActiveMonthKey(point.monthKey)}
                            onFocus={() => setActiveMonthKey(point.monthKey)}
                            onClick={() => setActiveMonthKey(point.monthKey)}
                          >
                            <rect
                              x={padLeft + slotWidth * index}
                              y={padTop}
                              width={slotWidth}
                              height={plotHeight + padBottom}
                              fill="transparent"
                            />
                            {point.totalAmount === 0 ? (
                              <rect
                                x={x}
                                y={padTop + plotHeight - 2}
                                width={barWidth}
                                height={2}
                                rx={1}
                                fill={isFocused ? '#475569' : '#1e293b'}
                              />
                            ) : (
                              <rect
                                x={x}
                                y={y}
                                width={barWidth}
                                height={barHeight}
                                rx={5}
                                fill={fillColor}
                                opacity={activeMonthKey && !isFocused ? 0.55 : 1}
                                style={{ transition: 'opacity 150ms ease, fill 150ms ease' }}
                              />
                            )}
                            <text
                              x={cx}
                              y={chartHeight - 10}
                              textAnchor="middle"
                              fill={
                                isFocused
                                  ? '#f8fafc'
                                  : point.isCurrentMonth
                                  ? '#34d399'
                                  : '#94a3b8'
                              }
                              fontWeight={isFocused || point.isCurrentMonth ? 600 : 400}
                              fontSize="11"
                              fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                            >
                              {point.shortLabel}
                            </text>
                          </g>
                        );
                      })}
                </svg>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                {effectiveMode === 'cashflow' ? (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm bg-emerald-500" />
                        <span>Collections</span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-sm bg-amber-500" />
                        <span>Expenses</span>
                      </span>
                    </div>
                    <span className="font-mono tabular-nums text-slate-300">
                      FY Net:{' '}
                      <strong className={netFyBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {formatINR(netFyBalance)}
                      </strong>
                    </span>
                  </>
                ) : effectiveMode === 'expenses' ? (
                  <>
                    <span>
                      Peak Outflow:{' '}
                      <strong className="text-slate-200 font-mono">
                        {peakExpenseMonth && peakExpenseMonth.expensesAmount > 0
                          ? `${peakExpenseMonth.fullLabel} (${formatINR(peakExpenseMonth.expensesAmount)})`
                          : '—'}
                      </strong>
                    </span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {totalExpenseEntries} expense entr{totalExpenseEntries === 1 ? 'y' : 'ies'}
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      Peak Month:{' '}
                      <strong className="text-slate-200 font-mono">
                        {peakCollectionMonth
                          ? `${peakCollectionMonth.fullLabel} (${formatINR(peakCollectionMonth.totalAmount)})`
                          : '—'}
                      </strong>
                    </span>
                    {monthlyTrend.some((m) => m.isCurrentMonth) && (
                      <span className="font-mono tabular-nums text-slate-500">
                        Current month highlighted in green
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 2. Right Panel (Category Breakdown or Net Cash Flow Summary) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
          {effectiveMode === 'cashflow' ? (
            <>
              <div className="space-y-1 border-b border-slate-800 pb-3.5">
                <div className="flex items-center gap-2 text-white font-semibold text-sm tracking-tight">
                  <ArrowLeftRight className="w-4 h-4 text-emerald-400 shrink-0" />
                  <h2>{fyLabel} Net Summary</h2>
                </div>
                <p className="text-xs text-slate-400">
                  Total collections vs. total church expenses
                </p>
              </div>

              <div className="space-y-3 flex-1">
                <div className="bg-slate-950 rounded-xl p-3.5 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 block">Total Collections</span>
                    <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {totalReceipts} valid receipt{totalReceipts === 1 ? '' : 's'}
                    </span>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-sm text-emerald-400">
                    {formatINR(totalCollections)}
                  </span>
                </div>

                <div className="bg-slate-950 rounded-xl p-3.5 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-slate-400 block">Total Expenses</span>
                    <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {totalExpenseEntries} expense entr{totalExpenseEntries === 1 ? 'y' : 'ies'}
                    </span>
                  </div>
                  <span className="font-mono tabular-nums font-bold text-sm text-amber-400">
                    {formatINR(totalExpenses)}
                  </span>
                </div>

                <div className="bg-slate-950 rounded-xl p-3.5 flex items-center justify-between border border-slate-800">
                  <div>
                    <span className="text-xs text-white font-semibold block">Net FY Balance</span>
                    <span className="text-[11px] text-slate-500">
                      {netFyBalance >= 0 ? 'Surplus position' : 'Deficit position'}
                    </span>
                  </div>
                  <span
                    className={`font-mono tabular-nums font-bold text-base ${
                      netFyBalance >= 0 ? 'text-sky-400' : 'text-rose-400'
                    }`}
                  >
                    {formatINR(netFyBalance)}
                  </span>
                </div>

                {expenseCategoryBreakdown.length > 0 && (
                  <div className="pt-2 space-y-1.5 text-xs">
                    <span className="text-[11px] text-slate-400 font-medium block">
                      Top Expense Category
                    </span>
                    <div className="flex items-center justify-between text-slate-200">
                      <span className="truncate font-medium">
                        {expenseCategoryBreakdown[0].categoryName}
                      </span>
                      <span className="font-mono tabular-nums text-amber-400 font-semibold">
                        {formatINR(expenseCategoryBreakdown[0].totalAmount)} ({expenseCategoryBreakdown[0].percentage.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {onOpenExpenses && (
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={onOpenExpenses}
                    className="text-xs text-amber-400 hover:text-amber-300 underline font-medium cursor-pointer"
                  >
                    Manage expenses &rarr;
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-slate-800 pb-3.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-white font-semibold text-sm tracking-tight">
                    <PieChart
                      className={`w-4 h-4 shrink-0 ${
                        effectiveMode === 'expenses' ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    />
                    <h2>
                      {isMember
                        ? 'My Giving by Category'
                        : effectiveMode === 'expenses'
                        ? 'Expenses by Category'
                        : 'Collections by Category'}
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400">
                    {fyLabel} · {activeCategoryList.length} active categor
                    {activeCategoryList.length === 1 ? 'y' : 'ies'}
                  </p>
                </div>

                {!isLoading && inspectedCategory && (
                  <div className="text-left sm:text-right">
                    <div className="text-[11px] text-slate-400 truncate max-w-[160px]">
                      {inspectedCategory.categoryName}
                    </div>
                    <div
                      className={`text-sm font-bold font-mono tabular-nums ${
                        effectiveMode === 'expenses' ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {inspectedCategory.percentage.toFixed(1)}%
                    </div>
                  </div>
                )}
              </div>

              {isLoading ? (
                <div className="space-y-3 py-2 animate-pulse">
                  {Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="space-y-1.5">
                      <div className="h-3 bg-slate-800 rounded w-1/2" />
                      <div className="h-2.5 bg-slate-800/80 rounded w-full" />
                    </div>
                  ))}
                </div>
              ) : activeCategoryList.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-center px-4">
                  <p className="text-xs text-slate-400 max-w-xs">
                    {effectiveMode === 'expenses'
                      ? `Expense category shares will appear here once expenses are recorded in ${fyLabel}.`
                      : `Category shares will appear here once donations are recorded in ${fyLabel}.`}
                  </p>
                </div>
              ) : (
                <div className="space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div
                      className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden flex gap-0.5 p-0.5 border border-slate-800"
                      aria-hidden="true"
                    >
                      {activeCategoryList.map((cat, index) => {
                        const barClass = barPalette[index % barPalette.length];
                        const isDimmed =
                          activeCategoryName !== null && activeCategoryName !== cat.categoryName;
                        return (
                          <div
                            key={cat.categoryName}
                            className={`h-full first:rounded-l-full last:rounded-r-full ${barClass} transition-opacity duration-150`}
                            style={{
                              width: `${Math.max(cat.percentage, 2)}%`,
                              opacity: isDimmed ? 0.35 : 1,
                            }}
                          />
                        );
                      })}
                    </div>

                    <div
                      className="space-y-2.5 max-h-[195px] overflow-y-auto pr-1"
                      onMouseLeave={() => setActiveCategoryName(null)}
                    >
                      {activeCategoryList.map((cat, index) => {
                        const barClass = barPalette[index % barPalette.length];
                        const isSelected = activeCategoryName === cat.categoryName;
                        const topAmount = activeCategoryList[0]?.totalAmount || 1;
                        const relativeWidth = Math.max(4, (cat.totalAmount / topAmount) * 100);

                        return (
                          <button
                            key={cat.categoryName}
                            type="button"
                            onMouseEnter={() => setActiveCategoryName(cat.categoryName)}
                            onFocus={() => setActiveCategoryName(cat.categoryName)}
                            onClick={() =>
                              setActiveCategoryName((prev) =>
                                prev === cat.categoryName ? null : cat.categoryName
                              )
                            }
                            className={`w-full text-left rounded-xl px-2.5 py-2 transition-colors cursor-pointer ${
                              isSelected ? 'bg-slate-800/70' : 'hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`w-2 h-2 rounded-sm shrink-0 ${barClass}`} />
                                <span className="font-medium text-white truncate">
                                  {cat.categoryName}
                                </span>
                                <span className="text-[11px] text-slate-500 font-mono tabular-nums shrink-0">
                                  · {cat.count}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
                                <span className="text-[11px] text-slate-400">
                                  {cat.percentage.toFixed(1)}%
                                </span>
                                <span className="font-semibold text-slate-100">
                                  {formatINR(cat.totalAmount)}
                                </span>
                              </div>
                            </div>

                            <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${barClass}`}
                                style={{ width: `${relativeWidth}%` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono tabular-nums">
                    <span>
                      {effectiveMode === 'expenses'
                        ? `${totalExpenseEntries} expense entries`
                        : `${totalReceipts} total receipts`}
                    </span>
                    <span
                      className={`font-semibold ${
                        effectiveMode === 'expenses' ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {formatINR(effectiveMode === 'expenses' ? totalExpenses : totalCollections)}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
};


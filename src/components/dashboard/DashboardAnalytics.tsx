import React, { useState } from 'react';
import {
  formatINR,
  formatCompactINR,
  type MonthlyFyTrendPoint,
  type CategoryBreakdownItem,
} from '../../lib/domain-logic';
import { BarChart3, PieChart, PlusCircle } from 'lucide-react';

interface DashboardAnalyticsProps {
  fyLabel: string;
  isMember: boolean;
  isLoading: boolean;
  monthlyTrend: MonthlyFyTrendPoint[];
  categoryBreakdown: CategoryBreakdownItem[];
  onRecordDonation?: () => void;
}

const CATEGORY_BAR_CLASSES = [
  'bg-sky-500',
  'bg-emerald-500',
  'bg-cyan-400',
  'bg-teal-400',
  'bg-indigo-400',
  'bg-amber-400',
];

const CATEGORY_SWATCH_CLASSES = [
  'bg-sky-500',
  'bg-emerald-500',
  'bg-cyan-400',
  'bg-teal-400',
  'bg-indigo-400',
  'bg-amber-400',
];

export const DashboardAnalytics: React.FC<DashboardAnalyticsProps> = ({
  fyLabel,
  isMember,
  isLoading,
  monthlyTrend,
  categoryBreakdown,
  onRecordDonation,
}) => {
  const [activeMonthKey, setActiveMonthKey] = useState<string | null>(null);
  const [activeCategoryName, setActiveCategoryName] = useState<string | null>(null);

  const totalFyAmount = categoryBreakdown.reduce((sum, item) => sum + item.totalAmount, 0);
  const totalFyReceipts = categoryBreakdown.reduce((sum, item) => sum + item.receiptCount, 0);

  const maxMonthlyAmount = Math.max(...monthlyTrend.map((m) => m.totalAmount), 0);
  const yAxisMax = maxMonthlyAmount > 0 ? maxMonthlyAmount * 1.15 : 1000;

  const currentMonthPoint = monthlyTrend.find((m) => m.isCurrentMonth) || monthlyTrend[0] || null;
  const peakMonthPoint = monthlyTrend.reduce<MonthlyFyTrendPoint | null>((best, curr) => {
    if (!best || curr.totalAmount > best.totalAmount) return curr;
    return best;
  }, null);

  const inspectedMonth =
    monthlyTrend.find((m) => m.monthKey === activeMonthKey) ||
    (currentMonthPoint && currentMonthPoint.totalAmount > 0 ? currentMonthPoint : peakMonthPoint);

  const inspectedCategory =
    categoryBreakdown.find((c) => c.categoryName === activeCategoryName) ||
    categoryBreakdown[0] ||
    null;

  // SVG coordinate space for 12-month bar chart
  const chartWidth = 600;
  const chartHeight = 220;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 32;
  const plotWidth = chartWidth - padLeft - padRight;
  const plotHeight = chartHeight - padTop - padBottom;
  const slotWidth = plotWidth / Math.max(monthlyTrend.length, 1);
  const barWidth = Math.min(28, slotWidth * 0.58);

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <section aria-label="Financial Year Analytics" className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* 1. Monthly Collections Trend (Apr - Mar) */}
      <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-white font-semibold text-sm tracking-tight">
              <BarChart3 className="w-4 h-4 text-sky-400 shrink-0" />
              <h2>{isMember ? 'My Monthly Giving Trend' : 'Monthly Collections Trend'}</h2>
            </div>
            <p className="text-xs text-slate-400">
              {fyLabel} · Apr to Mar valid receipts
            </p>
          </div>

          {!isLoading && inspectedMonth && maxMonthlyAmount > 0 && (
            <div className="text-left sm:text-right">
              <div className="text-[11px] text-slate-400 font-mono">
                {inspectedMonth.fullLabel}
                {inspectedMonth.isCurrentMonth ? ' (Current Month)' : ''}
              </div>
              <div className="text-sm font-bold font-mono tabular-nums text-sky-400">
                {formatINR(inspectedMonth.totalAmount)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                {inspectedMonth.receiptCount} receipt{inspectedMonth.receiptCount === 1 ? '' : 's'}
              </div>
            </div>
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
        ) : maxMonthlyAmount === 0 ? (
          <div className="h-[220px] flex flex-col items-center justify-center text-center px-4 space-y-3">
            <p className="text-xs text-slate-400 max-w-sm">
              {isMember
                ? `No contributions recorded for ${fyLabel} yet. Monthly totals from April to March will chart here automatically.`
                : `No valid donations recorded for ${fyLabel} yet. Monthly collection bars will appear here as receipts are saved.`}
            </p>
            {!isMember && onRecordDonation && (
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
                aria-label={`${isMember ? 'My monthly giving trend' : 'Monthly collections trend'} for ${fyLabel}`}
                className="w-full min-w-[460px] h-[220px] select-none"
                onMouseLeave={() => setActiveMonthKey(null)}
              >
                {/* Horizontal Gridlines & Y-Axis Ticks */}
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

                {/* 12 Month Bars (Apr - Mar) */}
                {monthlyTrend.map((point, index) => {
                  const cx = padLeft + slotWidth * index + slotWidth / 2;
                  const x = cx - barWidth / 2;
                  const barHeight =
                    point.totalAmount > 0
                      ? Math.max(4, (point.totalAmount / yAxisMax) * plotHeight)
                      : 0;
                  const y = padTop + plotHeight - barHeight;
                  const isFocused = inspectedMonth?.monthKey === point.monthKey;

                  const fillColor =
                    point.totalAmount === 0
                      ? '#1e293b'
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
                      aria-label={`${point.fullLabel}: ${formatINR(point.totalAmount)} across ${point.receiptCount} receipts`}
                      className="cursor-pointer outline-none"
                      onMouseEnter={() => setActiveMonthKey(point.monthKey)}
                      onFocus={() => setActiveMonthKey(point.monthKey)}
                      onClick={() => setActiveMonthKey(point.monthKey)}
                    >
                      {/* Full-slot hit area for easy hover/tap even on empty months */}
                      <rect
                        x={padLeft + slotWidth * index}
                        y={padTop}
                        width={slotWidth}
                        height={plotHeight + padBottom}
                        fill="transparent"
                      />

                      {/* Subtle baseline bar when month has 0 donations */}
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

                      {/* Month Label */}
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
              <span>
                Peak Month:{' '}
                <strong className="text-slate-200 font-mono">
                  {peakMonthPoint ? `${peakMonthPoint.fullLabel} (${formatINR(peakMonthPoint.totalAmount)})` : '—'}
                </strong>
              </span>
              {monthlyTrend.some((m) => m.isCurrentMonth) && (
                <span className="font-mono tabular-nums text-slate-500">
                  Current month highlighted in green
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Collections Breakdown by Category */}
      <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-slate-800 pb-3.5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-white font-semibold text-sm tracking-tight">
              <PieChart className="w-4 h-4 text-emerald-400 shrink-0" />
              <h2>{isMember ? 'My Giving by Category' : 'Collections by Category'}</h2>
            </div>
            <p className="text-xs text-slate-400">
              {fyLabel} · {categoryBreakdown.length} active categor{categoryBreakdown.length === 1 ? 'y' : 'ies'}
            </p>
          </div>

          {!isLoading && inspectedCategory && (
            <div className="text-left sm:text-right">
              <div className="text-[11px] text-slate-400 truncate max-w-[160px]">
                {inspectedCategory.categoryName}
              </div>
              <div className="text-sm font-bold font-mono tabular-nums text-emerald-400">
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
        ) : categoryBreakdown.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-center px-4">
            <p className="text-xs text-slate-400 max-w-xs">
              Category shares will appear here once donations are recorded in {fyLabel}.
            </p>
          </div>
        ) : (
          <div className="space-y-4 flex-1 flex flex-col justify-between">
            {/* Stacked Share Bar */}
            <div className="space-y-3">
              <div
                className="h-2.5 w-full bg-slate-950 rounded-full overflow-hidden flex gap-0.5 p-0.5 border border-slate-800"
                aria-hidden="true"
              >
                {categoryBreakdown.map((cat, index) => {
                  const barClass = CATEGORY_BAR_CLASSES[index % CATEGORY_BAR_CLASSES.length];
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

              {/* Category Bars List */}
              <div
                className="space-y-2.5 max-h-[195px] overflow-y-auto pr-1"
                onMouseLeave={() => setActiveCategoryName(null)}
              >
                {categoryBreakdown.map((cat, index) => {
                  const barClass = CATEGORY_BAR_CLASSES[index % CATEGORY_BAR_CLASSES.length];
                  const swatchClass =
                    CATEGORY_SWATCH_CLASSES[index % CATEGORY_SWATCH_CLASSES.length];
                  const isSelected = activeCategoryName === cat.categoryName;
                  const topAmount = categoryBreakdown[0]?.totalAmount || 1;
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
                          <span className={`w-2 h-2 rounded-sm shrink-0 ${swatchClass}`} />
                          <span className="font-medium text-white truncate">
                            {cat.categoryName}
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono tabular-nums shrink-0">
                            · {cat.receiptCount}
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
              <span>{totalFyReceipts} total receipts</span>
              <span className="text-emerald-400 font-semibold">
                {formatINR(totalFyAmount)}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

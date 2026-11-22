import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { ScreenId } from '../common/Sidebar';
import {
  getFinancialYear,
  formatINR,
  calculateRankings,
  computeCurrentMonthSummary,
  buildMonthlyFyTrend,
  buildCategoryBreakdown,
  type DashboardDonationInput,
} from '../../lib/domain-logic';
import { DashboardAnalytics } from '../dashboard/DashboardAnalytics';
import {
  PlusCircle,
  FileSpreadsheet,
  ArrowRight,
} from 'lucide-react';

interface DashboardScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

interface DashboardDonationRow extends DashboardDonationInput {
  id: string;
  receipt_number: string;
  created_at?: string;
  member?: {
    full_name?: string | null;
    member_number?: string | null;
  } | null;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigate }) => {
  const { activeChurch, activeRole, isPlatformAdmin, user, profile, pendingRequests } = useAuth();

  const currentFY = getFinancialYear(new Date());

  const [fyDonations, setFyDonations] = useState<DashboardDonationRow[]>([]);
  const [totalCollections, setTotalCollections] = useState(0);
  const [activeDonationCount, setActiveDonationCount] = useState(0);
  const [activeMemberCount, setActiveMemberCount] = useState(0);
  const [inactiveMemberCount, setInactiveMemberCount] = useState(0);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [userTotalGiving, setUserTotalGiving] = useState(0);
  const [recentDonations, setRecentDonations] = useState<DashboardDonationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const isStaff = activeRole === 'admin' || activeRole === 'accountant' || activeRole === 'collector' || isPlatformAdmin;
  const isMember = activeRole === 'member';

  useEffect(() => {
    if (!supabase || !activeChurch) {
      setIsLoading(false);
      return;
    }

    const fetchDashboardData = async () => {
      setIsLoading(true);
      try {
        if (isStaff) {
          // Fetch members count
          const { data: memData } = await supabase
            .from('members')
            .select('membership_status')
            .eq('church_id', activeChurch.id);

          if (memData) {
            setActiveMemberCount(memData.filter((m) => m.membership_status === 'active').length);
            setInactiveMemberCount(memData.filter((m) => m.membership_status === 'inactive').length);
          }

          // Fetch FY donations with member & category info
          const { data: donData } = await supabase
            .from('donations')
            .select('id, receipt_number, donation_date, amount, created_at, deleted_at, member:members(full_name, member_number), category:donation_categories(name)')
            .eq('church_id', activeChurch.id)
            .is('deleted_at', null)
            .gte('donation_date', currentFY.startDate)
            .lte('donation_date', currentFY.endDate)
            .order('donation_date', { ascending: false })
            .order('created_at', { ascending: false });

          if (donData) {
            const rows = donData as unknown as DashboardDonationRow[];
            const sum = rows.reduce((acc, d) => acc + Number(d.amount), 0);
            setFyDonations(rows);
            setTotalCollections(sum);
            setActiveDonationCount(rows.length);
            setRecentDonations(rows.slice(0, 5));
          } else {
            setFyDonations([]);
          }
        } else if (isMember && user) {
          // Member view: fetch member record linked to user
          const { data: link } = await supabase
            .from('member_account_links')
            .select('member_id, member:members(*)')
            .eq('church_id', activeChurch.id)
            .eq('user_id', user.id)
            .maybeSingle();

          if (link) {
            // Fetch member's own FY donations with category name
            const { data: memberDonations } = await supabase
              .from('donations')
              .select('id, receipt_number, donation_date, amount, created_at, deleted_at, category:donation_categories(name)')
              .eq('church_id', activeChurch.id)
              .eq('member_id', link.member_id)
              .is('deleted_at', null)
              .gte('donation_date', currentFY.startDate)
              .lte('donation_date', currentFY.endDate)
              .order('donation_date', { ascending: false })
              .order('created_at', { ascending: false });

            if (memberDonations) {
              const rows = memberDonations as unknown as DashboardDonationRow[];
              const myTotal = rows.reduce((acc, d) => acc + Number(d.amount), 0);
              setFyDonations(rows);
              setUserTotalGiving(myTotal);
              setRecentDonations(rows.slice(0, 5));
            } else {
              setFyDonations([]);
            }

            // Calculate Rank (active members only)
            const { data: allFyDonations } = await supabase
              .from('donations')
              .select('member_id, amount, member:members(full_name, membership_status)')
              .eq('church_id', activeChurch.id)
              .is('deleted_at', null)
              .gte('donation_date', currentFY.startDate)
              .lte('donation_date', currentFY.endDate);

            if (allFyDonations) {
              const donorTotals = new Map<string, {
                memberId: string;
                memberName: string;
                totalAmount: number;
                isActive: boolean;
              }>();
              for (const d of allFyDonations) {
                const memberInfo = d.member as unknown as {
                  full_name?: string | null;
                  membership_status?: string | null;
                } | null;
                const isMemberActive = memberInfo?.membership_status === 'active';
                if (!isMemberActive) continue;

                const existing = donorTotals.get(d.member_id) || {
                  memberId: d.member_id,
                  memberName: memberInfo?.full_name || 'Member',
                  totalAmount: 0,
                  isActive: true,
                };
                existing.totalAmount += Number(d.amount);
                donorTotals.set(d.member_id, existing);
              }
              const ranked = calculateRankings(Array.from(donorTotals.values()));
              const meRank = ranked.find((r) => r.memberId === link.member_id);
              setUserRank(meRank ? meRank.rank : null);
            }
          } else {
            setFyDonations([]);
          }
        }
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDashboardData();
  }, [activeChurch, isStaff, isMember, user, currentFY.startDate, currentFY.endDate]);

  const monthSummary = useMemo(
    () => computeCurrentMonthSummary(fyDonations),
    [fyDonations]
  );

  const monthlyTrend = useMemo(
    () => buildMonthlyFyTrend(fyDonations, currentFY.startYear),
    [fyDonations, currentFY.startYear]
  );

  const categoryBreakdown = useMemo(
    () => buildCategoryBreakdown(fyDonations),
    [fyDonations]
  );

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-sky-950/40 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="text-sky-300 font-mono font-semibold">
              {currentFY.label}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-medium">
              1 April {currentFY.startYear} – 31 March {currentFY.endYear}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Welcome back, {profile?.full_name || 'Member'}
          </h1>
          <p className="text-xs text-slate-400">
            Active Church: <strong className="text-slate-200">{activeChurch?.name}</strong>
          </p>
        </div>

        {isStaff && (
          <button
            type="button"
            onClick={() => onNavigate('record_donation')}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer self-start sm:self-auto whitespace-nowrap shrink-0"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Record Donation</span>
          </button>
        )}
      </div>

      {/* STAFF METRICS */}
      {isStaff && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total FY Collections */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-xs text-slate-400 font-medium block">
              FY Collections ({currentFY.fyCode})
            </span>
            <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
              {formatINR(totalCollections)}
            </div>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums block">
              {activeDonationCount} valid receipt{activeDonationCount === 1 ? '' : 's'} recorded
            </span>
          </div>

          {/* This Month Collections (replaces Receipt Format) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-xs text-slate-400 font-medium block">
              This Month ({monthSummary.monthLabel})
            </span>
            <div className="text-2xl font-bold font-mono tabular-nums text-sky-400">
              {formatINR(monthSummary.totalAmount)}
            </div>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums block">
              {monthSummary.receiptCount} receipt{monthSummary.receiptCount === 1 ? '' : 's'} this month
            </span>
          </div>

          {/* Members Active & Inactive */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
            <span className="text-xs text-slate-400 font-medium block">
              Church Members
            </span>
            <div className="grid grid-cols-2 divide-x divide-slate-800">
              <div className="pr-3">
                <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
                  {activeMemberCount}
                </div>
                <span className="text-[11px] text-slate-400 font-medium block mt-0.5">
                  Active
                </span>
              </div>
              <div className="pl-3">
                <div className="text-2xl font-bold font-mono tabular-nums text-slate-300">
                  {inactiveMemberCount}
                </div>
                <span className="text-[11px] text-slate-400 font-medium block mt-0.5">
                  Inactive
                </span>
              </div>
            </div>
          </div>

          {/* Pending Approvals */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-xs text-slate-400 font-medium block">
              Pending Approvals
            </span>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-400">
              {pendingRequests.length}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('approvals')}
              className="text-[11px] text-sky-400 hover:text-sky-300 underline font-medium block cursor-pointer"
            >
              Review queue &rarr;
            </button>
          </div>
        </div>
      )}

      {/* MEMBER METRICS */}
      {isMember && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-xs text-slate-400 font-medium block">
              My FY Contributions
            </span>
            <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
              {formatINR(userTotalGiving)}
            </div>
            <span className="text-[11px] text-slate-500 font-mono tabular-nums block">
              {fyDonations.length} receipt{fyDonations.length === 1 ? '' : 's'} this financial year
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-xs text-slate-400 font-medium block">
              My Giving Rank
            </span>
            <div className="text-2xl font-bold font-mono tabular-nums text-sky-400">
              {userRank ? `#${userRank}` : 'Not Ranked'}
            </div>
            <span className="text-[11px] text-slate-500 font-mono block">
              Competition ranking in {currentFY.label}
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-xs text-slate-400 font-medium block">
              Financial Statement
            </span>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="mt-1 w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs py-2 px-4 rounded-xl border border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
              <span>Download PDF Statement</span>
            </button>
          </div>
        </div>
      )}

      {/* ANALYTICS CHARTS (Staff: Church-wide | Member: Personal Giving) */}
      {(isStaff || isMember) && (
        <DashboardAnalytics
          fyLabel={currentFY.label}
          isMember={isMember}
          isLoading={isLoading}
          monthlyTrend={monthlyTrend}
          categoryBreakdown={categoryBreakdown}
          onRecordDonation={isStaff ? () => onNavigate('record_donation') : undefined}
        />
      )}

      {/* Recent Receipts Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-white tracking-tight">
            {isMember ? 'My Recent Receipts' : 'Recent Valid Collections'}
          </h2>
          <button
            type="button"
            onClick={() => onNavigate(isMember ? 'reports' : 'donations')}
            className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium transition-colors cursor-pointer"
          >
            <span>View All</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/30 text-slate-400 font-medium">
                <th className="py-2.5 px-4 font-mono">Receipt #</th>
                <th className="py-2.5 px-4">Date</th>
                {!isMember && <th className="py-2.5 px-4">Member</th>}
                <th className="py-2.5 px-4 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading ? (
                <tr>
                  <td colSpan={isMember ? 3 : 4} className="py-6 text-center text-slate-500">
                    Loading recent records...
                  </td>
                </tr>
              ) : recentDonations.length === 0 ? (
                <tr>
                  <td colSpan={isMember ? 3 : 4} className="py-6 text-center text-slate-500">
                    No donations recorded for {currentFY.label} yet.
                  </td>
                </tr>
              ) : (
                recentDonations.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono font-medium text-sky-400">
                      {d.receipt_number}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-400">
                      {d.donation_date}
                    </td>
                    {!isMember && (
                      <td className="py-2.5 px-4 font-medium text-white">
                        {d.member?.full_name || 'Member'}
                      </td>
                    )}
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-emerald-400">
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


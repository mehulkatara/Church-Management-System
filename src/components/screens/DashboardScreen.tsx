import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import type { ScreenId } from '../common/Sidebar';
import {
  getFinancialYear,
  formatINR,
  calculateRankings,
} from '../../lib/domain-logic';
import {
  Building2,
  Users,
  Receipt,
  IndianRupee,
  Clock,
  PlusCircle,
  FileSpreadsheet,
  Trophy,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';

interface DashboardScreenProps {
  onNavigate: (screen: ScreenId) => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigate }) => {
  const { activeChurch, activeRole, isPlatformAdmin, user, profile, pendingRequests } = useAuth();

  const currentFY = getFinancialYear(new Date());

  const [totalCollections, setTotalCollections] = useState(0);
  const [activeDonationCount, setActiveDonationCount] = useState(0);
  const [activeMemberCount, setActiveMemberCount] = useState(0);
  const [inactiveMemberCount, setInactiveMemberCount] = useState(0);
  const [userRank, setUserRank] = useState<number | null>(null);
  const [userTotalGiving, setUserTotalGiving] = useState(0);
  const [recentDonations, setRecentDonations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const isStaff = activeRole === 'admin' || activeRole === 'accountant' || activeRole === 'collector' || isPlatformAdmin;
  const isMember = activeRole === 'member';

  useEffect(() => {
    if (!supabase || !activeChurch) return;

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

          // Fetch FY donations
          const { data: donData } = await supabase
            .from('donations')
            .select('*, member:members(full_name, member_number)')
            .eq('church_id', activeChurch.id)
            .is('deleted_at', null)
            .gte('donation_date', currentFY.startDate)
            .lte('donation_date', currentFY.endDate)
            .order('donation_date', { ascending: false });

          if (donData) {
            const sum = donData.reduce((acc, d) => acc + Number(d.amount), 0);
            setTotalCollections(sum);
            setActiveDonationCount(donData.length);
            setRecentDonations(donData.slice(0, 5));
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
            // Fetch member's own donations
            const { data: memberDonations } = await supabase
              .from('donations')
              .select('*')
              .eq('church_id', activeChurch.id)
              .eq('member_id', link.member_id)
              .is('deleted_at', null)
              .gte('donation_date', currentFY.startDate)
              .lte('donation_date', currentFY.endDate)
              .order('donation_date', { ascending: false });

            if (memberDonations) {
              const myTotal = memberDonations.reduce((acc, d) => acc + Number(d.amount), 0);
              setUserTotalGiving(myTotal);
              setRecentDonations(memberDonations.slice(0, 5));
            }

            // Calculate Rank
            const { data: allFyDonations } = await supabase
              .from('donations')
              .select('member_id, amount, member:members(full_name, membership_status)')
              .eq('church_id', activeChurch.id)
              .is('deleted_at', null)
              .gte('donation_date', currentFY.startDate)
              .lte('donation_date', currentFY.endDate);

            if (allFyDonations) {
              const donorTotals = new Map<string, any>();
              for (const d of allFyDonations) {
                const existing = donorTotals.get(d.member_id) || {
                  memberId: d.member_id,
                  memberName: (d.member as any)?.full_name || 'Member',
                  totalAmount: 0,
                  isActive: true,
                };
                existing.totalAmount += Number(d.amount);
                donorTotals.set(d.member_id, existing);
              }
              const ranked = calculateRankings(Array.from(donorTotals.values()));
              const meRank = ranked.find((r) => r.memberId === link.member_id);
              if (meRank) setUserRank(meRank.rank);
            }
          }
        }
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, [activeChurch, isStaff, isMember, user]);

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-sky-950/40 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs bg-sky-500/15 text-sky-300 font-mono px-2.5 py-0.5 rounded-lg border border-sky-500/30">
              {currentFY.label}
            </span>
            <span className="text-xs text-slate-400 font-medium">
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
            onClick={() => onNavigate('record_donation')}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs py-2.5 px-4 rounded-xl flex items-center gap-2 transition-colors shadow-lg shadow-sky-600/20 cursor-pointer self-start sm:self-auto"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Record Donation</span>
          </button>
        )}
      </div>

      {/* STAFF METRICS */}
      {isStaff && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Collections */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider block">
              FY Collections ({currentFY.label})
            </span>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {formatINR(totalCollections)}
            </div>
            <span className="text-[11px] text-slate-500 font-mono block">
              {activeDonationCount} valid receipts recorded
            </span>
          </div>

          {/* Members */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider block">
              Church Members
            </span>
            <div className="text-2xl font-bold text-white">
              {activeMemberCount} <span className="text-xs font-normal text-slate-400">Active</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono block">
              {inactiveMemberCount} inactive (history preserved)
            </span>
          </div>

          {/* Pending Approvals */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider block">
              Pending Approvals
            </span>
            <div className="text-2xl font-bold text-amber-400">
              {pendingRequests.length}
            </div>
            <button
              onClick={() => onNavigate('approvals')}
              className="text-[11px] text-sky-400 hover:text-sky-300 underline font-medium block"
            >
              Review queue &rarr;
            </button>
          </div>

          {/* Receipt Prefix */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider block">
              Receipt Book Prefix
            </span>
            <div className="text-lg font-bold font-mono text-sky-400 truncate">
              {activeChurch?.receipt_prefix || 'REC/2026-27/'}
            </div>
            <span className="text-[11px] text-slate-500 font-mono block">
              Manual entry required
            </span>
          </div>
        </div>
      )}

      {/* MEMBER METRICS */}
      {isMember && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider block">
              My FY Contributions
            </span>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {formatINR(userTotalGiving)}
            </div>
            <span className="text-[11px] text-slate-500 font-mono block">
              {recentDonations.length} receipts this financial year
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider block">
              My Giving Rank
            </span>
            <div className="text-2xl font-bold text-sky-400">
              {userRank ? `#${userRank}` : 'Not Ranked'}
            </div>
            <span className="text-[11px] text-slate-500 font-mono block">
              Competition ranking in {currentFY.label}
            </span>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-[11px] text-slate-400 uppercase font-mono tracking-wider block">
              Financial Statement
            </span>
            <button
              onClick={() => onNavigate('reports')}
              className="mt-1 w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs py-2 rounded-xl border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />
              <span>Download PDF Statement</span>
            </button>
          </div>
        </div>
      )}

      {/* Recent Receipts Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-white tracking-tight">
            {isMember ? 'My Recent Receipts' : 'Recent Valid Collections'}
          </h2>
          <button
            onClick={() => onNavigate(isMember ? 'reports' : 'donations')}
            className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-medium transition-colors"
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
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    Loading recent records...
                  </td>
                </tr>
              ) : recentDonations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-500">
                    No donations recorded for {currentFY.label} yet.
                  </td>
                </tr>
              ) : (
                recentDonations.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-4 font-mono font-medium text-sky-400">
                      {d.receipt_number}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-400">{d.donation_date}</td>
                    {!isMember && (
                      <td className="py-2.5 px-4 font-medium text-white">
                        {d.member?.full_name || 'Member'}
                      </td>
                    )}
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

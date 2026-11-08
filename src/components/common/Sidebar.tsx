import React from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  PlusCircle,
  Receipt,
  Users,
  UserCheck,
  FolderTree,
  FileSpreadsheet,
  Trophy,
  History,
  MessageSquare,
  Building,
  UserCog,
  Settings,
  User,
} from 'lucide-react';

export type ScreenId =
  | 'dashboard'
  | 'record_donation'
  | 'donations'
  | 'members'
  | 'approvals'
  | 'categories'
  | 'reports'
  | 'leaderboard'
  | 'audit'
  | 'notifications'
  | 'churches'
  | 'staff'
  | 'profile'
  | 'settings';

interface SidebarProps {
  currentScreen: ScreenId;
  onSelectScreen: (screen: ScreenId) => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentScreen,
  onSelectScreen,
  isMobileOpen,
  onCloseMobile,
}) => {
  const { activeRole, isPlatformAdmin, pendingRequests } = useAuth();

  const isStaff = activeRole === 'admin' || activeRole === 'accountant' || activeRole === 'collector' || isPlatformAdmin;
  const isAccountantOrAdmin = activeRole === 'admin' || activeRole === 'accountant' || isPlatformAdmin;
  const isAccountantOnly = activeRole === 'accountant' || isPlatformAdmin;
  const isAdmin = activeRole === 'admin' || isPlatformAdmin;
  const isMember = activeRole === 'member';

  const handleNav = (screen: ScreenId) => {
    onSelectScreen(screen);
    onCloseMobile();
  };

  const navItemClass = (screen: ScreenId) => {
    const isActive = currentScreen === screen;
    return `w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
      isActive
        ? 'bg-sky-500/15 text-sky-300 font-semibold border border-sky-500/30'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
    }`;
  };

  const content = (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 w-64 p-4 space-y-6">
      {/* Quick Action: Record Donation (Prominent for staff) */}
      {isStaff && (
        <button
          onClick={() => handleNav('record_donation')}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-semibold text-xs py-3 px-4 rounded-xl shadow-lg shadow-sky-500/20 transition-all cursor-pointer"
        >
          <PlusCircle className="w-4 h-4" />
          <span>Record New Donation</span>
        </button>
      )}

      {/* Nav List */}
      <nav className="flex-1 space-y-1 overflow-y-auto pr-1">
        <button onClick={() => handleNav('dashboard')} className={navItemClass('dashboard')}>
          <div className="flex items-center gap-2.5">
            <LayoutDashboard className="w-4 h-4" />
            <span>Dashboard</span>
          </div>
        </button>

        {/* Transactions & Records */}
        {isStaff && (
          <>
            <button onClick={() => handleNav('donations')} className={navItemClass('donations')}>
              <div className="flex items-center gap-2.5">
                <Receipt className="w-4 h-4" />
                <span>Donation Registry</span>
              </div>
            </button>

            <button onClick={() => handleNav('members')} className={navItemClass('members')}>
              <div className="flex items-center gap-2.5">
                <Users className="w-4 h-4" />
                <span>Member Directory</span>
              </div>
            </button>
          </>
        )}

        {/* Approvals (Accountant) */}
        {isAccountantOnly && (
          <button onClick={() => handleNav('approvals')} className={navItemClass('approvals')}>
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-4 h-4" />
              <span>Access Approvals</span>
            </div>
            {pendingRequests.length > 0 && (
              <span className="bg-amber-500 text-slate-950 font-bold text-[10px] px-1.5 py-0.5 rounded-full">
                {pendingRequests.length}
              </span>
            )}
          </button>
        )}

        {/* Setup & Master Data (Admin & Accountant) */}
        {isAccountantOrAdmin && (
          <button onClick={() => handleNav('categories')} className={navItemClass('categories')}>
            <div className="flex items-center gap-2.5">
              <FolderTree className="w-4 h-4" />
              <span>Categories &amp; Accounts</span>
            </div>
          </button>
        )}

        {/* Reports */}
        <button onClick={() => handleNav('reports')} className={navItemClass('reports')}>
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-4 h-4" />
            <span>{isMember ? 'My Statements' : 'Financial Reports'}</span>
          </div>
        </button>

        {/* Leaderboard */}
        <button onClick={() => handleNav('leaderboard')} className={navItemClass('leaderboard')}>
          <div className="flex items-center gap-2.5">
            <Trophy className="w-4 h-4" />
            <span>Leaderboard</span>
          </div>
        </button>

        {/* SMS / Notifications */}
        {isStaff && (
          <button onClick={() => handleNav('notifications')} className={navItemClass('notifications')}>
            <div className="flex items-center gap-2.5">
              <MessageSquare className="w-4 h-4" />
              <span>SMS Confirmations</span>
            </div>
          </button>
        )}

        {/* Audit History (Admin & Accountant) */}
        {isAccountantOrAdmin && (
          <button onClick={() => handleNav('audit')} className={navItemClass('audit')}>
            <div className="flex items-center gap-2.5">
              <History className="w-4 h-4" />
              <span>Audit History</span>
            </div>
          </button>
        )}

        {/* Platform / Church Admin Only */}
        {isAdmin && (
          <>
            <div className="pt-3 pb-1 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Administration
            </div>

            <button onClick={() => handleNav('churches')} className={navItemClass('churches')}>
              <div className="flex items-center gap-2.5">
                <Building className="w-4 h-4" />
                <span>Churches</span>
              </div>
            </button>

            <button onClick={() => handleNav('staff')} className={navItemClass('staff')}>
              <div className="flex items-center gap-2.5">
                <UserCog className="w-4 h-4" />
                <span>Staff &amp; Permissions</span>
              </div>
            </button>

            <button onClick={() => handleNav('settings')} className={navItemClass('settings')}>
              <div className="flex items-center gap-2.5">
                <Settings className="w-4 h-4" />
                <span>Church Settings</span>
              </div>
            </button>
          </>
        )}
      </nav>

      {/* Bottom Profile Link */}
      <div className="pt-2 border-t border-slate-800">
        <button onClick={() => handleNav('profile')} className={navItemClass('profile')}>
          <div className="flex items-center gap-2.5">
            <User className="w-4 h-4" />
            <span>My Profile</span>
          </div>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:block shrink-0">{content}</aside>

      {/* Mobile Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <div className="relative z-10">{content}</div>
        </div>
      )}
    </>
  );
};

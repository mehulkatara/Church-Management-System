import React, { useState } from 'react';
import { supabaseConfig } from './lib/supabase';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SetupRequiredScreen } from './components/common/SetupRequiredScreen';
import { Navbar } from './components/common/Navbar';
import { Sidebar, ScreenId } from './components/common/Sidebar';
import { AuthScreen } from './components/screens/AuthScreen';
import { ApprovalStatusScreen } from './components/screens/ApprovalStatusScreen';
import { DashboardScreen } from './components/screens/DashboardScreen';
import { RecordDonationScreen } from './components/screens/RecordDonationScreen';
import { DonationsScreen } from './components/screens/DonationsScreen';
import { MembersScreen } from './components/screens/MembersScreen';
import { AccessApprovalsScreen } from './components/screens/AccessApprovalsScreen';
import { CategoriesScreen } from './components/screens/CategoriesScreen';
import { ReportsScreen } from './components/screens/ReportsScreen';
import { LeaderboardScreen } from './components/screens/LeaderboardScreen';
import { AuditHistoryScreen } from './components/screens/AuditHistoryScreen';
import { NotificationStatusScreen } from './components/screens/NotificationStatusScreen';
import { ChurchManagementScreen } from './components/screens/ChurchManagementScreen';
import { StaffManagementScreen } from './components/screens/StaffManagementScreen';
import { MyProfileScreen } from './components/screens/MyProfileScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { ShieldCheck, Eye, Database } from 'lucide-react';

const MainAppContent: React.FC<{
  previewMode?: boolean;
  onExitPreview?: () => void;
}> = ({ previewMode = false, onExitPreview }) => {
  const { user, isLoading, activeRole, authorizedChurches, pendingRequests } = useAuth();
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  if (isLoading && !previewMode) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 text-xs font-mono">
        Loading church permissions...
      </div>
    );
  }

  // Not logged in -> Show Auth Screen
  if (!user && !previewMode) {
    return <AuthScreen />;
  }

  // Logged in, but has pending access requests and 0 approved churches -> Show Approval Status
  if (
    !previewMode &&
    authorizedChurches.length === 0 &&
    pendingRequests.length > 0 &&
    activeRole === 'none'
  ) {
    return <ApprovalStatusScreen />;
  }

  const renderScreen = () => {
    switch (currentScreen) {
      case 'dashboard':
        return <DashboardScreen onNavigate={setCurrentScreen} />;
      case 'record_donation':
        return <RecordDonationScreen onDonationSaved={() => setCurrentScreen('donations')} />;
      case 'donations':
        return <DonationsScreen />;
      case 'members':
        return <MembersScreen />;
      case 'approvals':
        return <AccessApprovalsScreen />;
      case 'categories':
        return <CategoriesScreen />;
      case 'reports':
        return <ReportsScreen />;
      case 'leaderboard':
        return <LeaderboardScreen />;
      case 'audit':
        return <AuditHistoryScreen />;
      case 'notifications':
        return <NotificationStatusScreen />;
      case 'churches':
        return <ChurchManagementScreen />;
      case 'staff':
        return <StaffManagementScreen />;
      case 'profile':
        return <MyProfileScreen />;
      case 'settings':
        return <SettingsScreen />;
      default:
        return <DashboardScreen onNavigate={setCurrentScreen} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {previewMode && (
        <div className="bg-amber-500/20 border-b border-amber-500/30 px-4 py-2 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>UI Design Architecture Preview:</strong> Showing component layouts &amp; forms.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-300 font-medium">Jump to Screen:</span>
            <select
              value={currentScreen}
              onChange={(e) => setCurrentScreen(e.target.value as ScreenId)}
              className="bg-slate-900 border border-slate-700 text-amber-200 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-amber-400"
            >
              <option value="dashboard">Dashboard</option>
              <option value="record_donation">Record Donation</option>
              <option value="donations">Donation Registry</option>
              <option value="members">Member Directory</option>
              <option value="approvals">Access Approvals</option>
              <option value="categories">Categories &amp; Accounts</option>
              <option value="reports">Financial Reports</option>
              <option value="leaderboard">Leaderboard</option>
              <option value="notifications">SMS Confirmations</option>
              <option value="audit">Audit History</option>
              <option value="churches">Churches</option>
              <option value="staff">Staff Management</option>
              <option value="profile">My Profile</option>
              <option value="settings">Settings</option>
            </select>

            {onExitPreview && (
              <button
                onClick={onExitPreview}
                className="text-xs bg-slate-900 hover:bg-slate-800 text-white font-medium px-3 py-1 rounded-lg border border-slate-700 transition-colors"
              >
                Exit to Setup Screen
              </button>
            )}
          </div>
        </div>
      )}

      <Navbar
        isMobileMenuOpen={isMobileMenuOpen}
        onMobileMenuToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        onNavigateToProfile={() => setCurrentScreen('profile')}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          currentScreen={currentScreen}
          onSelectScreen={setCurrentScreen}
          isMobileOpen={isMobileMenuOpen}
          onCloseMobile={() => setIsMobileMenuOpen(false)}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto">{renderScreen()}</div>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  const [isPreviewActive, setIsPreviewActive] = useState(false);

  // If Supabase credentials are not set, show the SetupRequiredScreen by default
  if (!supabaseConfig.isConfigured && !isPreviewActive) {
    return (
      <div className="relative">
        <SetupRequiredScreen />
        <div className="fixed bottom-4 right-4 z-50">
          <button
            onClick={() => setIsPreviewActive(true)}
            className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 transition-all cursor-pointer border border-sky-400/30"
          >
            <Eye className="w-4 h-4" />
            <span>Inspect UI Architecture Preview</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthProvider>
      <MainAppContent
        previewMode={isPreviewActive}
        onExitPreview={() => setIsPreviewActive(false)}
      />
    </AuthProvider>
  );
}

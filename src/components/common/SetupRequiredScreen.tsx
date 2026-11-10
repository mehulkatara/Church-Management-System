import React, { useState } from 'react';
import { supabaseConfig, saveSupabaseCredentials } from '../../lib/supabase';
import {
  ShieldAlert,
  Database,
  Key,
  Copy,
  CheckCircle,
  FileCode,
  Layers,
  ExternalLink,
  ChevronRight,
  Info,
  Save,
} from 'lucide-react';

interface SetupRequiredScreenProps {
  onCheckAgain?: () => void;
}

export const SetupRequiredScreen: React.FC<SetupRequiredScreenProps> = () => {
  const [activeTab, setActiveTab] = useState<'status' | 'migrations' | 'seed' | 'checklist'>('status');
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [inputUrl, setInputUrl] = useState<string>(supabaseConfig.supabaseUrl || 'https://hjbepzqiitktxlqilhzo.supabase.co');
  const [inputAnonKey, setInputAnonKey] = useState<string>('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const handleSaveCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl) return;
    saveSupabaseCredentials(inputUrl, inputAnonKey);
    setSaveMessage('Credentials saved! Reloading application...');
  };

  const copyToClipboard = (text: string, sectionId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionId);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const envSample = `# Frontend Supabase Configuration (.env or deployment variables)
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header Banner */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
              Church Management System
              <span className="text-xs bg-amber-500/20 text-amber-300 font-mono px-2 py-0.5 rounded border border-amber-500/30">
                Setup Required
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Authoritative Supabase database configuration is required to proceed.
            </p>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400 block">Specification Rule:</span>
          <span className="text-xs font-medium text-amber-300">
            Zero fake data or mock databases in production mode
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
        {/* Honest Status Alert Box */}
        <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/40 rounded-2xl p-6 shadow-xl">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-500/20 rounded-xl text-amber-400 shrink-0">
              <Database className="w-6 h-6" />
            </div>
            <div className="space-y-2 flex-1">
              <h2 className="text-lg font-semibold text-white">
                Supabase Backend Not Connected
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                As required by the Church Management System specification, all authoritative
                business records (churches, members, donations, audit history, and receipt numbers)
                reside in Supabase PostgreSQL with atomic database functions. The application does
                not silently switch to a fake in-memory browser database or simulate registrations.
              </p>

              <div className="mt-4 pt-4 border-t border-slate-800 grid sm:grid-cols-2 gap-4">
                <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                  <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>Supabase Project URL</span>
                    <span className="text-emerald-400 font-bold">Detected</span>
                  </div>
                  <div className="text-sm font-mono text-emerald-300 font-semibold truncate">
                    {supabaseConfig.supabaseUrl || 'https://hjbepzqiitktxlqilhzo.supabase.co'}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Auto-configured from your Supabase Google OAuth token
                  </div>
                </div>

                <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                  <div className="text-xs font-mono text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>Publishable Key</span>
                    <span className={supabaseConfig.hasAnonKey ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                      {supabaseConfig.hasAnonKey ? 'Ready' : 'Optional / Configurable'}
                    </span>
                  </div>
                  <div className="text-sm font-mono text-amber-300 font-semibold">
                    VITE_SUPABASE_PUBLISHABLE_KEY
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Public anon client key from Supabase Dashboard &rarr; API
                  </div>
                </div>
              </div>

              {/* Quick Connect Browser Box */}
              <div className="mt-4 p-4 bg-slate-950/90 rounded-xl border border-slate-800 space-y-3">
                <h4 className="text-xs font-semibold text-white flex items-center gap-2">
                  <Key className="w-3.5 h-3.5 text-sky-400" />
                  <span>Interactive Quick Connect Credentials</span>
                </h4>
                <form onSubmit={handleSaveCredentials} className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1">Supabase URL</label>
                      <input
                        type="url"
                        value={inputUrl}
                        onChange={(e) => setInputUrl(e.target.value)}
                        required
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Anon / Publishable Key</label>
                      <input
                        type="text"
                        value={inputAnonKey}
                        onChange={(e) => setInputAnonKey(e.target.value)}
                        placeholder="Paste your anon public key from Supabase dashboard"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-500">
                      Saves to browser storage and reloads connection automatically.
                    </span>
                    <button
                      type="submit"
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>Save &amp; Connect</span>
                    </button>
                  </div>
                  {saveMessage && (
                    <p className="text-xs text-emerald-400 font-medium">{saveMessage}</p>
                  )}
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 gap-2">
          <button
            onClick={() => setActiveTab('status')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'status'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Info className="w-4 h-4" />
            Setup Guide &amp; Environment
          </button>
          <button
            onClick={() => setActiveTab('migrations')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'migrations'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-4 h-4" />
            Database Migrations (SQL)
          </button>
          <button
            onClick={() => setActiveTab('seed')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'seed'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-4 h-4" />
            Optional Development Seed
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'checklist'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            Architecture &amp; Permissions Matrix
          </button>
        </div>

        {/* Tab 1: Setup Guide */}
        {activeTab === 'status' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <span>Step-by-Step Supabase Connection Instructions</span>
              </h3>

              <ol className="space-y-4 text-sm text-slate-300">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <div>
                    <strong className="text-white block">Create a Supabase Project</strong>
                    Sign up or log in at{' '}
                    <a
                      href="https://supabase.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-400 underline inline-flex items-center gap-1"
                    >
                      supabase.com <ExternalLink className="w-3 h-3" />
                    </a>{' '}
                    and create a new PostgreSQL project (e.g., in Singapore or Mumbai region).
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <div>
                    <strong className="text-white block">Execute SQL Migrations in SQL Editor</strong>
                    Open your Supabase Project Dashboard &rarr; <strong>SQL Editor</strong> &rarr; New Query.
                    Copy and run the contents from the <strong>Database Migrations (SQL)</strong> tab:
                    <ul className="list-disc list-inside mt-1 text-slate-400 text-xs space-y-1">
                      <li><code>supabase/migrations/20261108000001_initial_schema.sql</code> (Tables, RLS &amp; Indexes)</li>
                      <li><code>supabase/migrations/20261108000002_atomic_functions.sql</code> (Atomic donation &amp; status RPCs)</li>
                    </ul>
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <div>
                    <strong className="text-white block">Copy Project API Credentials</strong>
                    Go to <strong>Project Settings &rarr; API &amp; Auth &rarr; Data API</strong>.
                    Copy the <strong>Project URL</strong> and <strong>anon public key</strong>.
                  </div>
                </li>

                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    4
                  </span>
                  <div>
                    <strong className="text-white block">Add Frontend Environment Variables</strong>
                    Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in your environment or <code>.env</code> file.
                  </div>
                </li>
              </ol>

              {/* Sample .env block with Copy */}
              <div className="mt-4 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-slate-400">.env / Environment snippet:</span>
                  <button
                    onClick={() => copyToClipboard(envSample, 'env')}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-sky-400 px-3 py-1 rounded-lg border border-slate-700 flex items-center gap-1.5 transition-colors"
                  >
                    {copiedSection === 'env' ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSection === 'env' ? 'Copied!' : 'Copy Template'}
                  </button>
                </div>
                <pre className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-sky-300 overflow-x-auto">
                  {envSample}
                </pre>
              </div>
            </div>

            {/* First Admin Bootstrap Documentation */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-400" />
                First Admin Setup Procedure (Strict Security Rule)
              </h3>
              <p className="text-sm text-slate-300">
                Specification Rule: <em>"Never make the first public registrant an Admin automatically. Provide a controlled, documented first-Admin setup procedure."</em>
              </p>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-2 font-mono">
                <p className="text-slate-400 font-sans">
                  After registering your initial administrator account through Supabase Auth, assign Platform Admin privileges securely in the SQL Editor:
                </p>
                <pre className="text-emerald-400 bg-slate-900 p-2.5 rounded border border-slate-800 overflow-x-auto">
{`-- Replace with the registered user's email:
INSERT INTO public.platform_admins (user_id, notes)
SELECT id, 'Initial platform administrator setup'
FROM auth.users
WHERE email = 'admin@yourchurch.org';`}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Migrations */}
        {activeTab === 'migrations' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    1. Initial Schema Migration
                  </h3>
                  <p className="text-xs text-slate-400">
                    File: <code>supabase/migrations/20261108000001_initial_schema.sql</code> (18 tables, constraints, RLS policies)
                  </p>
                </div>
                <button
                  onClick={() => copyToClipboard('See file: supabase/migrations/20261108000001_initial_schema.sql', 'mig1')}
                  className="text-xs bg-sky-600 hover:bg-sky-500 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Migration File Created
                </button>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 space-y-1">
                <p className="text-sky-400">-- Key tables created:</p>
                <p>churches, profiles, platform_admins, church_access, members, member_account_links,</p>
                <p>access_requests, donation_categories, receiving_accounts, donations, receipt_number_registry,</p>
                <p>donation_revisions, audit_logs, church_settings, notifications, notification_jobs,</p>
                <p>notification_attempts, report_exports</p>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    2. Atomic Functions &amp; Security RPCs
                  </h3>
                  <p className="text-xs text-slate-400">
                    File: <code>supabase/migrations/20261108000002_atomic_functions.sql</code> (Concurrency &amp; status rules)
                  </p>
                </div>
                <button
                  onClick={() => copyToClipboard('See file: supabase/migrations/20261108000002_atomic_functions.sql', 'mig2')}
                  className="text-xs bg-sky-600 hover:bg-sky-500 text-white font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Functions File Created
                </button>
              </div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono text-slate-300 space-y-1">
                <p className="text-emerald-400">-- Atomic procedures:</p>
                <p>&bull; <code>record_donation()</code>: receipt reservation + revision + audit</p>
                <p>&bull; <code>correct_donation()</code>: old receipt stays reserved + new receipt + audit</p>
                <p>&bull; <code>cancel_donation()</code>: soft-delete + audit (receipt remains reserved)</p>
                <p>&bull; <code>change_member_status()</code>: strictly church Accountant only (Admin alone cannot)</p>
                <p>&bull; <code>approve_access_request()</code>: verify applicant, link account, grant member role</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Seed */}
        {activeTab === 'seed' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    Optional Development Seed Data
                  </h3>
                  <p className="text-xs text-amber-300">
                    Label: Fictional development test records only. Do not seed shared production passwords.
                  </p>
                </div>
                <span className="text-xs font-mono bg-slate-800 text-slate-300 px-3 py-1 rounded-md border border-slate-700">
                  supabase/seed.sql
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Seeds 2 sample churches (Grace Bethel Church, St. Mark Community Church), standard donation categories
                (Tithe, Offering, Building Fund, Missions), receiving accounts (Cash, Bank), and sample member records.
              </p>
            </div>
          </div>
        )}

        {/* Tab 4: Architecture & Permissions Matrix */}
        {activeTab === 'checklist' && (
          <div className="space-y-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <h3 className="text-base font-semibold text-white">
                Role &amp; Permissions Enforcement Matrix
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                      <th className="py-2.5 px-3">Operation / Capability</th>
                      <th className="py-2.5 px-3">Platform Admin</th>
                      <th className="py-2.5 px-3">Accountant</th>
                      <th className="py-2.5 px-3">Collector</th>
                      <th className="py-2.5 px-3">Member</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    <tr>
                      <td className="py-2 px-3 font-medium text-white">Create Church &amp; Staff Roles</td>
                      <td className="py-2 px-3 text-emerald-400 font-semibold">Yes</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-white">Change Active/Inactive Member Status</td>
                      <td className="py-2 px-3 text-amber-400 font-semibold">No (unless church Accountant)</td>
                      <td className="py-2 px-3 text-emerald-400 font-semibold">Yes (Reason req.)</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-white">Edit Village Name</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                      <td className="py-2 px-3 text-red-400">No (Read-only)</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-white">Edit Member Gender</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                      <td className="py-2 px-3 text-emerald-400">Yes (Own only)</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-white">Record New Donation</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-emerald-400 font-semibold">Yes</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-white">Edit / Cancel Donation</td>
                      <td className="py-2 px-3 text-emerald-400">Yes (Reason req.)</td>
                      <td className="py-2 px-3 text-emerald-400">Yes (Reason req.)</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-white">Approve Member Access Requests</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-emerald-400 font-semibold">Yes</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-white">Bulk Financial &amp; Member Exports</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                      <td className="py-2 px-3 text-red-400">No (Own PDF only)</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 font-medium text-white">View Church Audit Logs</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-emerald-400">Yes</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                      <td className="py-2 px-3 text-red-400">No</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/50 p-4 text-center text-xs text-slate-500">
        Church Management System &bull; Production Security &amp; Isolation Standards &bull; Asia/Kolkata
      </footer>
    </div>
  );
};

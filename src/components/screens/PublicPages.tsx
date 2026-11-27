import React from 'react';
import {
  Church as ChurchIcon,
  ShieldCheck,
  FileText,
  Scale,
  ArrowLeft,
  Users,
  Receipt,
  BarChart3,
  Lock,
  CheckCircle2,
  Mail,
  ExternalLink,
} from 'lucide-react';

export type PublicRoute = 'home' | 'privacy' | 'terms';

interface PublicPageProps {
  onNavigate: (path: string) => void;
  isAuthenticated?: boolean;
}

const PublicHeader: React.FC<{
  active: PublicRoute | 'auth';
  onNavigate: (path: string) => void;
  isAuthenticated?: boolean;
}> = ({ active, onNavigate, isAuthenticated }) => {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <header className="border-b border-slate-800/80 bg-slate-900/80 backdrop-blur sticky top-0 z-30">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <a
          href="/home"
          onClick={(e) => handleLinkClick(e, '/home')}
          className="flex items-center gap-2.5 text-white font-semibold tracking-tight hover:opacity-90 transition-opacity"
        >
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <ChurchIcon className="w-5 h-5" />
          </div>
          <div>
            <span className="text-sm font-bold block leading-tight">Church Management System</span>
            <span className="text-[10px] text-slate-400 font-normal block">
              Verified Member &amp; Donation Registry
            </span>
          </div>
        </a>

        <nav className="flex items-center gap-2 sm:gap-3 text-xs">
          <a
            href="/home"
            onClick={(e) => handleLinkClick(e, '/home')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              active === 'home'
                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-medium'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            Home
          </a>
          <a
            href="/privacy-policy"
            onClick={(e) => handleLinkClick(e, '/privacy-policy')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              active === 'privacy'
                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-medium'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            Privacy Policy
          </a>
          <a
            href="/terms-of-service"
            onClick={(e) => handleLinkClick(e, '/terms-of-service')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              active === 'terms'
                ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-medium'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            Terms of Service
          </a>
          <a
            href="/"
            onClick={(e) => handleLinkClick(e, '/')}
            className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors shadow-sm"
          >
            {isAuthenticated ? 'Open App' : 'Sign In'}
          </a>
        </nav>
      </div>
    </header>
  );
};

const PublicFooter: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <footer className="border-t border-slate-800/80 bg-slate-950 py-8 px-4 sm:px-6 text-xs text-slate-400">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ChurchIcon className="w-4 h-4 text-sky-400" />
          <span>&copy; 2026 Church Management System. All rights reserved.</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <a
            href="/home"
            onClick={(e) => handleLinkClick(e, '/home')}
            className="hover:text-white transition-colors"
          >
            Application Home
          </a>
          <a
            href="/privacy-policy"
            onClick={(e) => handleLinkClick(e, '/privacy-policy')}
            className="hover:text-white transition-colors"
          >
            Privacy Policy
          </a>
          <a
            href="/terms-of-service"
            onClick={(e) => handleLinkClick(e, '/terms-of-service')}
            className="hover:text-white transition-colors"
          >
            Terms of Service
          </a>
          <a
            href="mailto:08bic019@gmail.com"
            className="hover:text-sky-300 transition-colors flex items-center gap-1"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>08bic019@gmail.com</span>
          </a>
        </div>
      </div>
    </footer>
  );
};

export const PublicHomePage: React.FC<PublicPageProps> = ({ onNavigate, isAuthenticated }) => {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <PublicHeader active="home" onNavigate={onNavigate} isAuthenticated={isAuthenticated} />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10">
        {/* Hero Overview */}
        <section className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-300 text-xs font-medium">
            <ShieldCheck className="w-4 h-4 text-sky-400" />
            <span>Official Church Administration &amp; Member Portal</span>
          </div>

          <div className="space-y-3">
            <h1 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
              Church Management System
            </h1>
            <p className="text-sm sm:text-base text-slate-300 max-w-3xl leading-relaxed">
              A secure multi-church platform for managing verified member directories, manual paper
              receipt donations in INR, Indian financial-year reporting, and Accountant-controlled
              onboarding approvals.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <a
              href="/"
              onClick={(e) => handleLinkClick(e, '/')}
              className="bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs sm:text-sm px-5 py-3 rounded-xl transition-colors shadow-lg shadow-sky-600/20"
            >
              {isAuthenticated ? 'Return to Dashboard' : 'Continue to Sign In with Google'}
            </a>
            <a
              href="/privacy-policy"
              onClick={(e) => handleLinkClick(e, '/privacy-policy')}
              className="bg-slate-950 hover:bg-slate-800 text-slate-200 font-medium text-xs sm:text-sm px-4 py-3 rounded-xl border border-slate-700 transition-colors"
            >
              Read Privacy Policy
            </a>
            <a
              href="/terms-of-service"
              onClick={(e) => handleLinkClick(e, '/terms-of-service')}
              className="bg-slate-950 hover:bg-slate-800 text-slate-200 font-medium text-xs sm:text-sm px-4 py-3 rounded-xl border border-slate-700 transition-colors"
            >
              Terms of Service
            </a>
          </div>
        </section>

        {/* Core Capabilities */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-2.5">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Users className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-white">Verified Member Onboarding</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Applicants sign in with Google and submit a mandatory profile reviewed side-by-side
              by an authorized Church Accountant before accessing church records.
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Receipt className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-white">Manual Receipt Ledger</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Preserves paper receipt numbers permanently per church across financial years with
              full revision history, soft deletion protections, and SMS confirmation templates.
            </p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <BarChart3 className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-white">Financial-Year Audits</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Tracks contributions across Indian Financial Years (1 April – 31 March) with
              church-isolated access controls and Admin/Accountant status governance.
            </p>
          </div>
        </section>

        {/* Google Sign-In & People API Data Transparency */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-2.5">
            <Lock className="w-5 h-5 text-sky-400" />
            <h2 className="text-lg font-semibold text-white">
              How Google Sign-In &amp; Google People API Data Are Used
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Church Management System uses Google OAuth for secure authentication and, with your
            explicit consent, requests read-only access via the Google People API to pre-fill your
            new member onboarding application:
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-slate-300">
            <li className="flex items-start gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Email &amp; Name:</strong> Identifies your account
                and pre-fills your Full Name during registration.
              </span>
            </li>
            <li className="flex items-start gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Date of Birth &amp; Gender:</strong> Pre-fills
                required member verification fields for Accountant review.
              </span>
            </li>
            <li className="flex items-start gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Address (Village / City):</strong> Extracts locality
                for parish directory matching.
              </span>
            </li>
            <li className="flex items-start gap-2 bg-slate-950 p-3 rounded-xl border border-slate-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                <strong className="text-white">Strict Isolation:</strong> Google login alone never
                grants access to member or donation records without Accountant approval.
              </span>
            </li>
          </ul>
        </section>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export const PrivacyPolicyPage: React.FC<PublicPageProps> = ({ onNavigate, isAuthenticated }) => {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <PublicHeader active="privacy" onNavigate={onNavigate} isAuthenticated={isAuthenticated} />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-6">
        <a
          href="/home"
          onClick={(e) => handleLinkClick(e, '/home')}
          className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Application Home</span>
        </a>

        <article className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <div className="border-b border-slate-800 pb-5 space-y-2">
            <div className="flex items-center gap-2 text-sky-400 text-xs font-mono">
              <FileText className="w-4 h-4" />
              <span>Effective Date: November 14, 2026</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Privacy Policy — Church Management System
            </h1>
            <p className="text-xs text-slate-400">
              This Privacy Policy explains how Church Management System collects, uses, stores,
              and protects information provided by users, including data obtained through Google
              Sign-In and the Google People API.
            </p>
          </div>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">1. Information We Collect</h2>
            <p>
              When you sign in using Google OAuth and complete your onboarding profile, we collect
              the following categories of personal information with your consent:
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-300 pl-2">
              <li>
                <strong>Google Account Identity:</strong> Your verified Google email address and
                authenticated account identifier (UUID) used solely to sign you in.
              </li>
              <li>
                <strong>Google People API Profile Fields (Read-Only, With Consent):</strong> Full
                name (<code>userinfo.profile</code>), Date of Birth (<code>user.birthday.read</code>
                ), Village / City from your address (<code>user.addresses.read</code>), and Gender (
                <code>user.gender.read</code>) to pre-fill your new member application.
              </li>
              <li>
                <strong>Manually Provided Details:</strong> Contact phone number, selected church,
                optional separate contact email, and any manual edits you make to your onboarding
                or member profile.
              </li>
              <li>
                <strong>Church Administration &amp; Donation Records:</strong> Donation amounts,
                categories, manual receipt numbers, and membership status maintained by authorized
                church Collectors and Accountants.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">
              2. How We Use Information &amp; Google API Limited Use Policy
            </h2>
            <p>
              We use your information exclusively to operate Church Management System features for
              your selected church, including:
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-300 pl-2">
              <li>Authenticating your identity via Google Sign-In.</li>
              <li>
                Pre-filling your member onboarding form so an authorized church Accountant can verify
                and link your account to your member record.
              </li>
              <li>
                Providing approved members access to their own contribution statements and profile,
                and enabling authorized staff to manage receipts and financial-year reports.
              </li>
            </ul>
            <div className="bg-slate-950 border border-sky-500/20 rounded-xl p-4 text-xs text-sky-100 mt-2">
              <strong>Google API Services User Data Policy Compliance:</strong> Church Management
              System&apos;s use and transfer to any other app of information received from Google
              APIs will adhere to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 underline inline-flex items-center gap-0.5"
              >
                Google API Services User Data Policy
                <ExternalLink className="w-3 h-3" />
              </a>
              , including the Limited Use requirements. We do not sell Google user data, do not use
              it for advertising, and do not use it to train generalized AI or machine learning
              models.
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">
              3. Token Handling, Data Security &amp; Church Isolation
            </h2>
            <p>
              Google OAuth provider access tokens used to query the Google People API are held
              strictly in browser memory during your active session and are cleared upon sign-out.
              Application data is stored in Supabase PostgreSQL with Row-Level Security (RLS)
              policies enforcing strict isolation between churches and role-based access control.
              Authentication alone never grants access to member or donation records until
              explicitly approved by an authorized church Accountant.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">4. Data Sharing &amp; Retention</h2>
            <p>
              Your member onboarding information is visible only to authorized church Accountants
              and Administrators of the church you select. We do not sell, rent, or trade your
              personal information to third parties. Financial and receipt audit records are
              retained in accordance with church accounting and legal compliance requirements.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">
              5. Your Rights, Revoking Access &amp; Contact
            </h2>
            <p>
              You may review or update your personal details in <strong>My Profile</strong>, or
              revoke the application&apos;s access to your Google Account at any time from your{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 underline"
              >
                Google Account Permissions
              </a>{' '}
              page. For data deletion or privacy inquiries, contact the administrator at{' '}
              <a href="mailto:08bic019@gmail.com" className="text-sky-400 underline">
                08bic019@gmail.com
              </a>
              .
            </p>
          </section>
        </article>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

export const TermsOfServicePage: React.FC<PublicPageProps> = ({
  onNavigate,
  isAuthenticated,
}) => {
  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, path: string) => {
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <PublicHeader active="terms" onNavigate={onNavigate} isAuthenticated={isAuthenticated} />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-10 space-y-6">
        <a
          href="/home"
          onClick={(e) => handleLinkClick(e, '/home')}
          className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Application Home</span>
        </a>

        <article className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <div className="border-b border-slate-800 pb-5 space-y-2">
            <div className="flex items-center gap-2 text-sky-400 text-xs font-mono">
              <Scale className="w-4 h-4" />
              <span>Effective Date: November 14, 2026</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              Terms of Service — Church Management System
            </h1>
            <p className="text-xs text-slate-400">
              By accessing or using Church Management System, you agree to be bound by these Terms
              of Service.
            </p>
          </div>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">1. Eligibility &amp; Authentication</h2>
            <p>
              Access to Church Management System requires signing in with a valid Google account.
              Google authentication verifies your identity only; signing in does not automatically
              grant access to any church&apos;s member directory, donation records, or reports.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">
              2. Church Approval &amp; Role-Based Access
            </h2>
            <p>
              New applicants must submit accurate profile information (Full Name, Date of Birth,
              Phone Number, Gender, and Village / City Name) for review by an authorized church
              Accountant. Access to church resources is strictly scoped to approved roles:
            </p>
            <ul className="list-disc list-inside space-y-1 text-slate-300 pl-2">
              <li>
                <strong>Members:</strong> May view their own linked profile and personal donation
                history and update permitted self-profile fields.
              </li>
              <li>
                <strong>Collectors:</strong> May record donations and view permitted church member
                information for receipt issuance.
              </li>
              <li>
                <strong>Accountants &amp; Administrators:</strong> Manage church onboarding
                approvals, membership status changes, financial-year reports, and audit logs.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">
              3. Accuracy of Records &amp; Receipt Integrity
            </h2>
            <p>
              Users and church staff are responsible for providing accurate information. Active
              receipt numbers must be unique per church, and all donation creations, corrections, and
              cancellations are recorded in immutable revision and audit logs. Unauthorized alteration,
              falsification of donation receipts, or attempts to bypass church isolation controls are
              strictly prohibited and may result in immediate revocation of access.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">4. Privacy &amp; Google Data</h2>
            <p>
              Your use of the application is also governed by our{' '}
              <a
                href="/privacy-policy"
                onClick={(e) => handleLinkClick(e, '/privacy-policy')}
                className="text-sky-400 underline"
              >
                Privacy Policy
              </a>
              , which details how Google Sign-In and Google People API profile fields are handled.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">
              5. Service Availability &amp; Disclaimer
            </h2>
            <p>
              Church Management System is provided on an &quot;as-is&quot; and &quot;as-available&quot;
              basis for authorized church administration. While we take reasonable steps to secure
              data and preserve financial audit logs, we do not warrant uninterrupted availability
              and are not liable for indirect or incidental damages arising from service downtime.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-semibold text-white">6. Contact Information</h2>
            <p>
              For questions regarding these Terms of Service, please contact{' '}
              <a href="mailto:08bic019@gmail.com" className="text-sky-400 underline">
                08bic019@gmail.com
              </a>
              .
            </p>
          </section>
        </article>
      </main>

      <PublicFooter onNavigate={onNavigate} />
    </div>
  );
};

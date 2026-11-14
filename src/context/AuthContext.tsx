import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, supabaseConfig, parseOAuthCallback, parseTokenString } from '../lib/supabase';
import type { Church, Profile, ChurchAccess, AccessRequest, UserRole, Gender } from '../types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isPlatformAdmin: boolean;
  authorizedChurches: Church[];
  activeChurch: Church | null;
  activeRole: UserRole | 'none';
  churchAccessList: ChurchAccess[];
  pendingRequests: AccessRequest[];
  userRequests: AccessRequest[];
  activeRequest: AccessRequest | null;
  isLoading: boolean;
  error: string | null;
  setActiveChurchId: (churchId: string) => void;
  refreshUserData: () => Promise<void>;
  signOut: () => Promise<void>;
  loginAsPersona: (persona: string) => void;
  authenticateWithToken: (tokenOrUrl: string) => boolean;
}


const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SAMPLE_CHURCH: Church = {
  id: 'c1111111-1111-1111-1111-111111111111',
  code: 'BETHEL',
  name: 'Bethel Christian Assembly',
  address: '14 Anna Salai, Chennai',
  phone: '+91 44 2811 0000',
  email: 'admin@bethel.org',
  receipt_prefix: 'BCA',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean>(false);
  const [churchAccessList, setChurchAccessList] = useState<ChurchAccess[]>([]);
  const [authorizedChurches, setAuthorizedChurches] = useState<Church[]>([]);
  const [activeChurch, setActiveChurch] = useState<Church | null>(null);
  const [userRequests, setUserRequests] = useState<AccessRequest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Setup synthetic persona for preview mode if selected in sessionStorage
  const applyPersona = (persona: string): boolean => {
    const baseDate = new Date().toISOString();

    if (persona === 'applicant_new') {
      const mockUser = {
        id: 'u-app-new-1234',
        email: 'applicant.new@gmail.com',
        user_metadata: { full_name: 'Abraham Lincoln Raj' },
        created_at: baseDate,
        app_metadata: { provider: 'google' },
      } as unknown as User;
      setUser(mockUser);
      setProfile({
        id: mockUser.id,
        email: mockUser.email || '',
        full_name: 'Abraham Lincoln Raj',
        phone: null,
        created_at: baseDate,
        updated_at: baseDate,
      });
      setIsPlatformAdmin(false);
      setChurchAccessList([]);
      setAuthorizedChurches([]);
      setActiveChurch(null);
      setUserRequests([]);
      setIsLoading(false);
      return true;
    }

    if (persona === 'applicant_draft') {
      const mockUser = {
        id: 'u-app-draft-5678',
        email: 'draft.applicant@gmail.com',
        user_metadata: { full_name: 'John Peter' },
        created_at: baseDate,
        app_metadata: { provider: 'google' },
      } as unknown as User;
      setUser(mockUser);
      setProfile({
        id: mockUser.id,
        email: mockUser.email || '',
        full_name: 'John Peter',
        phone: '+919840123456',
        created_at: baseDate,
        updated_at: baseDate,
      });
      setIsPlatformAdmin(false);
      setChurchAccessList([]);
      setAuthorizedChurches([]);
      setActiveChurch(null);
      setUserRequests([
        {
          id: 'req-draft-1',
          church_id: SAMPLE_CHURCH.id,
          user_id: mockUser.id,
          applicant_name: 'John Peter',
          applicant_email: 'draft.applicant@gmail.com',
          applicant_phone: '+919840123456',
          date_of_birth: '1994-06-15',
          gender: 'male',
          village_name: 'Tambaram',
          submission_version: 1,
          is_draft: true,
          status: 'draft',
          requested_at: baseDate,
          decided_at: null,
          decided_by: null,
          decision_reason: null,
          linked_member_id: null,
          church: SAMPLE_CHURCH,
        },
      ]);
      setIsLoading(false);
      return true;
    }

    if (persona === 'applicant_returned') {
      const mockUser = {
        id: 'u-app-ret-9999',
        email: 'applicant.returned@gmail.com',
        user_metadata: { full_name: 'Stephen Joseph' },
        created_at: baseDate,
        app_metadata: { provider: 'google' },
      } as unknown as User;
      setUser(mockUser);
      setProfile({
        id: mockUser.id,
        email: mockUser.email || '',
        full_name: 'Stephen Joseph',
        phone: '+919840999999',
        created_at: baseDate,
        updated_at: baseDate,
      });
      setIsPlatformAdmin(false);
      setChurchAccessList([]);
      setAuthorizedChurches([]);
      setActiveChurch(null);
      setUserRequests([
        {
          id: 'req-returned-1',
          church_id: SAMPLE_CHURCH.id,
          user_id: mockUser.id,
          applicant_name: 'Stephen Joseph',
          applicant_email: 'applicant.returned@gmail.com',
          applicant_phone: '+919840999999',
          date_of_birth: '1992-11-04',
          gender: 'male',
          village_name: 'Kallakurichi',
          submission_version: 2,
          is_draft: false,
          status: 'returned_for_correction',
          requested_at: baseDate,
          decided_at: baseDate,
          decided_by: 'accountant-uuid',
          decision_reason:
            'Please verify your date of birth against your Aadhaar/church baptism record (year appears to be 1993, not 1992).',
          linked_member_id: null,
          church: SAMPLE_CHURCH,
        },
      ]);
      setIsLoading(false);
      return true;
    }

    if (persona === 'applicant_pending') {
      const mockUser = {
        id: 'u-app-pend-7777',
        email: 'applicant.pending@gmail.com',
        user_metadata: { full_name: 'Mary Magdalene' },
        created_at: baseDate,
        app_metadata: { provider: 'google' },
      } as unknown as User;
      setUser(mockUser);
      setProfile({
        id: mockUser.id,
        email: mockUser.email || '',
        full_name: 'Mary Magdalene',
        phone: '+919884111222',
        created_at: baseDate,
        updated_at: baseDate,
      });
      setIsPlatformAdmin(false);
      setChurchAccessList([]);
      setAuthorizedChurches([]);
      setActiveChurch(null);
      setUserRequests([
        {
          id: 'req-pending-1',
          church_id: SAMPLE_CHURCH.id,
          user_id: mockUser.id,
          applicant_name: 'Mary Magdalene',
          applicant_email: 'applicant.pending@gmail.com',
          applicant_phone: '+919884111222',
          date_of_birth: '1996-08-19',
          gender: 'female',
          village_name: 'Guindy',
          submission_version: 1,
          is_draft: false,
          status: 'pending',
          requested_at: baseDate,
          decided_at: null,
          decided_by: null,
          decision_reason: null,
          linked_member_id: null,
          church: SAMPLE_CHURCH,
        },
      ]);
      setIsLoading(false);
      return true;
    }

    if (persona === 'accountant') {
      const mockUser = {
        id: 'u-accountant-001',
        email: 'accountant@bethel.org',
        user_metadata: { full_name: 'Grace Thomas (Accountant)' },
        created_at: baseDate,
        app_metadata: { provider: 'google' },
      } as unknown as User;
      setUser(mockUser);
      setProfile({
        id: mockUser.id,
        email: 'accountant@bethel.org',
        full_name: 'Grace Thomas (Accountant)',
        phone: '+919840000001',
        created_at: baseDate,
        updated_at: baseDate,
      });
      setIsPlatformAdmin(false);
      const access: ChurchAccess = {
        id: 'acc-1',
        church_id: SAMPLE_CHURCH.id,
        user_id: mockUser.id,
        role: 'accountant',
        status: 'approved',
        granted_at: baseDate,
        granted_by: 'admin',
        notes: 'Assigned Church Accountant',
        church: SAMPLE_CHURCH,
      };
      setChurchAccessList([access]);
      setAuthorizedChurches([SAMPLE_CHURCH]);
      setActiveChurch(SAMPLE_CHURCH);
      setUserRequests([]);
      setIsLoading(false);
      return true;
    }

    if (persona === 'member') {
      const mockUser = {
        id: 'u-member-002',
        email: 'member@bethel.org',
        user_metadata: { full_name: 'David Paul (Member)' },
        created_at: baseDate,
        app_metadata: { provider: 'google' },
      } as unknown as User;
      setUser(mockUser);
      setProfile({
        id: mockUser.id,
        email: 'member@bethel.org',
        full_name: 'David Paul (Member)',
        phone: '+919840000002',
        created_at: baseDate,
        updated_at: baseDate,
      });
      setIsPlatformAdmin(false);
      const access: ChurchAccess = {
        id: 'acc-2',
        church_id: SAMPLE_CHURCH.id,
        user_id: mockUser.id,
        role: 'member',
        status: 'approved',
        granted_at: baseDate,
        granted_by: 'accountant',
        notes: 'Verified Member',
        church: SAMPLE_CHURCH,
      };
      setChurchAccessList([access]);
      setAuthorizedChurches([SAMPLE_CHURCH]);
      setActiveChurch(SAMPLE_CHURCH);
      setUserRequests([]);
      setIsLoading(false);
      return true;
    }

    if (persona === 'admin') {
      const mockUser = {
        id: 'u-admin-003',
        email: 'admin@bethel.org',
        user_metadata: { full_name: 'Platform Administrator' },
        created_at: baseDate,
        app_metadata: { provider: 'google' },
      } as unknown as User;
      setUser(mockUser);
      setProfile({
        id: mockUser.id,
        email: 'admin@bethel.org',
        full_name: 'Platform Administrator',
        phone: '+919840000003',
        created_at: baseDate,
        updated_at: baseDate,
      });
      setIsPlatformAdmin(true);
      setChurchAccessList([]);
      setAuthorizedChurches([SAMPLE_CHURCH]);
      setActiveChurch(SAMPLE_CHURCH);
      setUserRequests([]);
      setIsLoading(false);
      return true;
    }

    return false;
  };

  const fetchUserData = async (currentUser: User) => {
    // If a preview persona is stored, apply it directly
    const storedPersona = window.sessionStorage.getItem('cms_preview_persona');
    if (storedPersona && applyPersona(storedPersona)) {
      return;
    }

    // Initialize immediate profile from user Google metadata
    const initialFullName =
      currentUser.user_metadata?.full_name ||
      currentUser.user_metadata?.name ||
      currentUser.email?.split('@')[0] ||
      'User';

    const defaultProfile: Profile = {
      id: currentUser.id,
      email: currentUser.email || '',
      full_name: initialFullName,
      phone: currentUser.user_metadata?.phone || null,
      created_at: currentUser.created_at,
      updated_at: currentUser.created_at,
    };
    setProfile(defaultProfile);

    // Check for cached access requests for this user
    try {
      const cachedReqs = localStorage.getItem(`cms_requests_${currentUser.id}`);
      if (cachedReqs) {
        const parsed = JSON.parse(cachedReqs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setUserRequests(parsed as AccessRequest[]);
        }
      }
    } catch {
      // ignore
    }

    if (!supabase) {
      setIsLoading(false);
      return;
    }

    try {
      setError(null);

      // 1. Fetch Profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (profileData) {
        setProfile(profileData as Profile);
      }

      // 2. Check Platform Admin
      const { data: adminData } = await supabase
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      const isAdmin = Boolean(adminData);
      setIsPlatformAdmin(isAdmin);

      // 3. Fetch Church Access (only approved status grants church access)
      const { data: accessData } = await supabase
        .from('church_access')
        .select('*, church:churches(*)')
        .eq('user_id', currentUser.id)
        .eq('status', 'approved');

      const approvedAccess = (accessData || []) as ChurchAccess[];
      setChurchAccessList(approvedAccess);

      // 4. Fetch All User Access Requests (including draft, pending, returned_for_correction, rejected)
      const { data: requestsData } = await supabase
        .from('access_requests')
        .select('*, church:churches(*)')
        .eq('user_id', currentUser.id)
        .order('requested_at', { ascending: false });

      if (requestsData && requestsData.length > 0) {
        setUserRequests(requestsData as AccessRequest[]);
        try {
          localStorage.setItem(`cms_requests_${currentUser.id}`, JSON.stringify(requestsData));
        } catch {
          // ignore
        }
      }

      // 5. Determine Authorized Churches list
      if (isAdmin) {
        const { data: allChurches } = await supabase
          .from('churches')
          .select('*')
          .eq('is_active', true)
          .order('name');
        const churches = (allChurches || []) as Church[];
        setAuthorizedChurches(churches);
        if (churches.length > 0 && !activeChurch) {
          setActiveChurch(churches[0]);
        }
      } else {
        const churchesMap = new Map<string, Church>();
        for (const item of approvedAccess) {
          if (item.church && item.church.is_active) {
            churchesMap.set(item.church.id, item.church);
          }
        }
        const userChurches = Array.from(churchesMap.values());
        setAuthorizedChurches(userChurches);

        if (userChurches.length > 0) {
          if (!activeChurch || !churchesMap.has(activeChurch.id)) {
            setActiveChurch(userChurches[0]);
          }
        } else {
          setActiveChurch(null);
        }
      }
    } catch (err: unknown) {
      console.warn('Notice loading database permissions (authenticated profile active):', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Check if test persona is active in sessionStorage
    const storedPersona = window.sessionStorage.getItem('cms_preview_persona');
    if (storedPersona) {
      applyPersona(storedPersona);
      return;
    }

    // A. Check for OAuth callback token in the URL hash fragment
    const oauthData = parseOAuthCallback();
    if (oauthData) {
      const payload = oauthData.payload;
      const oauthUser: User = {
        id: payload.sub,
        app_metadata: payload.app_metadata || { provider: 'google', providers: ['google'] },
        user_metadata: payload.user_metadata || {},
        aud: payload.aud || 'authenticated',
        confirmation_sent_at: '',
        recovery_sent_at: '',
        email_change_sent_at: '',
        new_email: '',
        invited_at: '',
        action_link: '',
        email: payload.email || '',
        phone: payload.phone || '',
        created_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
        confirmed_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
        email_confirmed_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
        phone_confirmed_at: '',
        last_sign_in_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
        role: payload.role || 'authenticated',
        updated_at: new Date().toISOString(),
        identities: [],
        factors: [],
      };

      const oauthSession: Session = {
        access_token: oauthData.accessToken,
        refresh_token: oauthData.refreshToken || '',
        expires_in: oauthData.expiresIn || 3600,
        expires_at: payload.exp || Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user: oauthUser,
      };

      // Clean the fragment hash from the browser address bar immediately
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch {
        // ignore
      }

      // Store in localStorage for session durability across reloads
      try {
        localStorage.setItem('cms_oauth_user', JSON.stringify(oauthUser));
        localStorage.setItem('cms_oauth_session', JSON.stringify(oauthSession));
      } catch {
        // ignore
      }

      // Sync session into Supabase client
      if (supabase && oauthData.accessToken) {
        supabase.auth.setSession({
          access_token: oauthData.accessToken,
          refresh_token: oauthData.refreshToken || '',
        }).catch((err) => {
          console.warn('Supabase setSession notice:', err);
        });
      }

      setUser(oauthUser);
      setSession(oauthSession);
      fetchUserData(oauthUser);
      return;
    }

    // B. Check for stored OAuth user from previous session
    try {
      const savedUserStr = localStorage.getItem('cms_oauth_user');
      const savedSessionStr = localStorage.getItem('cms_oauth_session');
      if (savedUserStr) {
        const savedUser = JSON.parse(savedUserStr) as User;
        const savedSession = savedSessionStr ? (JSON.parse(savedSessionStr) as Session) : null;
        setUser(savedUser);
        setSession(savedSession);
        fetchUserData(savedUser);
        return;
      }
    } catch {
      localStorage.removeItem('cms_oauth_user');
      localStorage.removeItem('cms_oauth_session');
    }

    // C. Standard Supabase session check
    if (!supabaseConfig.isConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user);
      } else {
        setIsLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user);
      } else {
        setProfile(null);
        setIsPlatformAdmin(false);
        setChurchAccessList([]);
        setAuthorizedChurches([]);
        setActiveChurch(null);
        setUserRequests([]);
        setIsLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const setActiveChurchId = (churchId: string) => {
    const target = authorizedChurches.find((c) => c.id === churchId);
    if (target) {
      setActiveChurch(target);
    }
  };

  const refreshUserData = async () => {
    if (user) {
      await fetchUserData(user);
    }
  };

  const signOut = async () => {
    window.sessionStorage.removeItem('cms_preview_persona');
    try {
      localStorage.removeItem('cms_oauth_user');
      localStorage.removeItem('cms_oauth_session');
    } catch {
      // ignore
    }
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('Signout warning:', err);
      }
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setActiveChurch(null);
    setChurchAccessList([]);
    setAuthorizedChurches([]);
    setUserRequests([]);
  };

  // Active request is the most recent pending, draft, or returned_for_correction request
  const activeRequest = useMemo<AccessRequest | null>(() => {
    if (userRequests.length === 0) return null;
    const prioritized = userRequests.find(
      (r) =>
        r.status === 'returned_for_correction' ||
        r.status === 'pending' ||
        r.status === 'draft'
    );
    return prioritized || userRequests[0];
  }, [userRequests]);

  // Backward compatibility for components consuming pendingRequests
  const pendingRequests = useMemo(() => {
    return userRequests.filter((r) => r.status === 'pending');
  }, [userRequests]);

  // Compute active role strictly from database assignment
  const activeRole = useMemo<UserRole | 'none'>(() => {
    if (isPlatformAdmin) return 'platform_admin';
    if (!activeChurch) return 'none';

    const assignment = churchAccessList.find(
      (a) => a.church_id === activeChurch.id && a.status === 'approved'
    );

    if (assignment) {
      return assignment.role;
    }
    return 'none';
  }, [isPlatformAdmin, activeChurch, churchAccessList]);

  const loginAsPersona = (persona: string) => {
    window.sessionStorage.setItem('cms_preview_persona', persona);
    applyPersona(persona);
  };

  const authenticateWithToken = (tokenOrUrl: string): boolean => {
    const oauthData = parseTokenString(tokenOrUrl);
    if (!oauthData) return false;

    const payload = oauthData.payload;
    const oauthUser: User = {
      id: payload.sub,
      app_metadata: payload.app_metadata || { provider: 'google', providers: ['google'] },
      user_metadata: payload.user_metadata || {},
      aud: payload.aud || 'authenticated',
      confirmation_sent_at: '',
      recovery_sent_at: '',
      email_change_sent_at: '',
      new_email: '',
      invited_at: '',
      action_link: '',
      email: payload.email || '',
      phone: payload.phone || '',
      created_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
      confirmed_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
      email_confirmed_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
      phone_confirmed_at: '',
      last_sign_in_at: payload.iat ? new Date(payload.iat * 1000).toISOString() : new Date().toISOString(),
      role: payload.role || 'authenticated',
      updated_at: new Date().toISOString(),
      identities: [],
      factors: [],
    };

    const oauthSession: Session = {
      access_token: oauthData.accessToken,
      refresh_token: oauthData.refreshToken || '',
      expires_in: oauthData.expiresIn || 3600,
      expires_at: payload.exp || Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: oauthUser,
    };

    try {
      localStorage.setItem('cms_oauth_user', JSON.stringify(oauthUser));
      localStorage.setItem('cms_oauth_session', JSON.stringify(oauthSession));
    } catch {
      // ignore
    }

    if (supabase && oauthData.accessToken) {
      supabase.auth.setSession({
        access_token: oauthData.accessToken,
        refresh_token: oauthData.refreshToken || '',
      }).catch((err) => {
        console.warn('Supabase setSession notice:', err);
      });
    }

    setUser(oauthUser);
    setSession(oauthSession);
    fetchUserData(oauthUser);
    return true;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isPlatformAdmin,
        authorizedChurches,
        activeChurch,
        activeRole,
        churchAccessList,
        pendingRequests,
        userRequests,
        activeRequest,
        isLoading,
        error,
        setActiveChurchId,
        refreshUserData,
        signOut,
        loginAsPersona,
        authenticateWithToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

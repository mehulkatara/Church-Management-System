import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, supabaseConfig } from '../lib/supabase';
import type { Church, Profile, ChurchAccess, AccessRequest, UserRole } from '../types/database';

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
  isLoading: boolean;
  error: string | null;
  setActiveChurchId: (churchId: string) => void;
  refreshUserData: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean>(false);
  const [churchAccessList, setChurchAccessList] = useState<ChurchAccess[]>([]);
  const [authorizedChurches, setAuthorizedChurches] = useState<Church[]>([]);
  const [activeChurch, setActiveChurch] = useState<Church | null>(null);
  const [pendingRequests, setPendingRequests] = useState<AccessRequest[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUserData = async (currentUser: User) => {
    if (!supabase) return;

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
      } else {
        // Fallback profile if row hasn't synced yet
        setProfile({
          id: currentUser.id,
          email: currentUser.email || '',
          full_name: currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'User',
          phone: currentUser.user_metadata?.phone || null,
          created_at: currentUser.created_at,
          updated_at: currentUser.created_at,
        });
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

      // 4. Fetch Pending Access Requests
      const { data: requestsData } = await supabase
        .from('access_requests')
        .select('*, church:churches(*)')
        .eq('user_id', currentUser.id)
        .eq('status', 'pending');

      setPendingRequests((requestsData || []) as AccessRequest[]);

      // 5. Determine Authorized Churches list
      if (isAdmin) {
        // Platform Admins can see all active churches
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
        // Normal users only see churches they have approved access for
        const churchesMap = new Map<string, Church>();
        for (const item of approvedAccess) {
          if (item.church && item.church.is_active) {
            churchesMap.set(item.church.id, item.church);
          }
        }
        const userChurches = Array.from(churchesMap.values());
        setAuthorizedChurches(userChurches);

        // Maintain or set active church
        if (userChurches.length > 0) {
          if (!activeChurch || !churchesMap.has(activeChurch.id)) {
            setActiveChurch(userChurches[0]);
          }
        } else {
          setActiveChurch(null);
        }
      }
    } catch (err: unknown) {
      console.error('Error fetching user church authorization:', err);
      setError(err instanceof Error ? err.message : 'Failed to load user permissions.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!supabaseConfig.isConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    // Get current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserData(session.user);
      } else {
        setIsLoading(false);
      }
    });

    // Listen for auth state changes
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
        setPendingRequests([]);
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
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setActiveChurch(null);
    setChurchAccessList([]);
    setAuthorizedChurches([]);
  };

  // Compute active role strictly from database assignment
  const activeRole = useMemo<UserRole | 'none'>(() => {
    if (isPlatformAdmin) return 'platform_admin';
    if (!activeChurch) return 'none';

    // Check specific church assignments
    const assignment = churchAccessList.find(
      (a) => a.church_id === activeChurch.id && a.status === 'approved'
    );

    if (assignment) {
      return assignment.role;
    }
    return 'none';
  }, [isPlatformAdmin, activeChurch, churchAccessList]);

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
        isLoading,
        error,
        setActiveChurchId,
        refreshUserData,
        signOut,
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

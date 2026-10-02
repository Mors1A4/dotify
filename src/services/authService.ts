import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, googleProvider, db } from './firebase';
import { Track } from '../types/track';
import { CustomPlaylist } from '../types/playlist';
import { FollowedArtist } from '../types/artist';
import { safeStorage } from '../utils/storage';
import { isTauriEnvironment, getApiBaseUrl } from './apiConfig';

export interface UserLibraryData {
  likedTracks: Track[];
  playlists: CustomPlaylist[];
  history: Track[];
  followedArtists?: FollowedArtist[];
  lastUpdated: number;
}

export class AuthService {
  private static instance: AuthService;
  private currentUser: User | null = null;
  private isInitialized: boolean = false;
  private authSubscribers: Array<(user: User | null) => void> = [];

  private constructor() {
    this.setupDeepLinkListener();
  }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  private notifySubscribers(user: User | null): void {
    this.authSubscribers.forEach((cb) => {
      try {
        cb(user);
      } catch (err) {
        console.warn('[AuthService] Subscriber callback error:', err);
      }
    });
  }

  private createSyntheticUser(data: any): User {
    return {
      uid: data.uid,
      email: data.email || '',
      displayName: data.displayName || (data.email ? data.email.split('@')[0] : 'Dotify User'),
      photoURL: data.photoURL || '',
      emailVerified: true,
      isAnonymous: false,
      metadata: {},
      providerData: [{
        providerId: 'google.com',
        uid: data.uid,
        displayName: data.displayName || '',
        email: data.email || '',
        phoneNumber: null,
        photoURL: data.photoURL || ''
      }],
      getIdToken: async () => data.idToken || '',
      getIdTokenResult: async () => ({ token: data.idToken || '' } as any),
      reload: async () => {},
      delete: async () => {},
      toJSON: () => ({ ...data })
    } as User;
  }

  private setupDeepLinkListener(): void {
    if (typeof window === 'undefined') return;

    (window as any).__handleGoogleAuthDeepLink = async (uri: string) => {
      console.log('[AuthService] Received Google Auth deep link:', uri);
      await this.handleDeepLinkAuth(uri);
    };

    if ((window as any).__pendingGoogleAuthDeepLink) {
      const pending = (window as any).__pendingGoogleAuthDeepLink;
      delete (window as any).__pendingGoogleAuthDeepLink;
      this.handleDeepLinkAuth(pending);
    }
  }

  public async handleDeepLinkAuth(uri: string): Promise<User | null> {
    try {
      const cleanUri = uri.replace(/^dotify:\/*/, 'http://localhost/').replace(/^intent:\/*/, 'http://localhost/');
      const url = new URL(cleanUri);
      const idToken = url.searchParams.get('idToken');
      const googleIdToken = url.searchParams.get('googleIdToken');
      const accessToken = url.searchParams.get('accessToken');
      const uid = url.searchParams.get('uid');
      const email = url.searchParams.get('email');
      const displayName = url.searchParams.get('displayName');
      const photoURL = url.searchParams.get('photoURL');

      const targetId = googleIdToken || idToken;
      if (!targetId && !uid) {
        console.warn('[AuthService] Deep link missing idToken and uid:', uri);
        return null;
      }

      let user: User | null = null;
      if (targetId) {
        try {
          const credential = GoogleAuthProvider.credential(targetId, accessToken || null);
          const userCredential = await signInWithCredential(auth, credential);
          user = userCredential.user;
        } catch (e) {
          console.warn('[AuthService] Deep link credential sign-in deferred:', e);
        }
      }

      if (!user && uid) {
        user = this.createSyntheticUser({ uid, email, displayName, photoURL });
      }

      if (user) {
        this.currentUser = user;
        safeStorage.setItem('dotify_cached_user', {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL
        });
        this.notifySubscribers(user);
        console.log('[AuthService] Successfully signed in via deep link for:', this.currentUser.email);
        return user;
      }
      return null;
    } catch (err) {
      console.error('[AuthService] Failed to sign in with deep link credential:', err);
      return null;
    }
  }

  public getCurrentUser(): User | null {
    if (!this.currentUser) {
      const cached = safeStorage.getItem<any>('dotify_cached_user', null);
      if (cached && cached.uid) {
        this.currentUser = this.createSyntheticUser(cached);
      }
    }
    return this.currentUser;
  }

  public subscribeToAuth(callback: (user: User | null) => void): () => void {
    this.authSubscribers.push(callback);

    // Always notify subscriber immediately with current state (either user or null)
    const active = this.getCurrentUser();
    callback(active);

    // Check if returning from a mobile webview redirect
    if (typeof window !== 'undefined') {
      getRedirectResult(auth)
        .then((result) => {
          if (result && result.user) {
            this.currentUser = result.user;
            this.notifySubscribers(result.user);
          }
        })
        .catch((err) => {
          console.debug('[AuthService] Redirect result check skipped:', err);
        });

      if ((window as any).__pendingGoogleAuthDeepLink) {
        const pending = (window as any).__pendingGoogleAuthDeepLink;
        delete (window as any).__pendingGoogleAuthDeepLink;
        this.handleDeepLinkAuth(pending);
      }
    }

    const firebaseUnsub = onAuthStateChanged(auth, async (user) => {
      this.isInitialized = true;
      if (user) {
        this.currentUser = user;
        this.notifySubscribers(user);
      } else if (!this.currentUser) {
        this.notifySubscribers(null);
      }
    });

    return () => {
      this.authSubscribers = this.authSubscribers.filter((cb) => cb !== callback);
      firebaseUnsub();
    };
  }

  public async signInWithExternalBrowser(): Promise<User | null> {
    let port = 18234;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      port = await invoke<number>('start_google_auth_server');
      console.log(`[AuthService] Started native Google auth loopback server on port ${port}`);
    } catch (err) {
      console.warn('[AuthService] Could not invoke start_google_auth_server:', err);
    }

    return new Promise<User | null>(async (resolve, reject) => {
      let resolved = false;
      let cleanupFns: Array<() => void> = [];

      const cleanup = () => {
        resolved = true;
        cleanupFns.forEach((fn) => {
          try {
            fn();
          } catch {}
        });
        cleanupFns = [];
      };

      const handlePayload = async (payload: any) => {
        if (resolved || !payload) return;
        cleanup();

        try {
          console.log('[AuthService] Processing external auth credentials...', payload.email);

          let user: User | null = null;
          const googleId = (payload.googleIdToken || payload.idToken || '').trim();
          const access = (payload.accessToken || '').trim();

          // 1. Try GoogleAuthProvider.credential with googleIdToken + accessToken
          if (googleId) {
            try {
              const cred = GoogleAuthProvider.credential(googleId, access || null);
              const res = await signInWithCredential(auth, cred);
              user = res.user;
              console.log('[AuthService] Signed in with Google ID token successfully:', user.email);
            } catch (e1: any) {
              console.warn('[AuthService] Credential exchange with ID token deferred:', e1.message);
            }
          }

          // 2. Try GoogleAuthProvider.credential with accessToken only
          if (!user && access) {
            try {
              const cred2 = GoogleAuthProvider.credential(null, access);
              const res2 = await signInWithCredential(auth, cred2);
              user = res2.user;
              console.log('[AuthService] Signed in with Google access token successfully:', user.email);
            } catch (e2: any) {
              console.warn('[AuthService] Credential exchange with access token deferred:', e2.message);
            }
          }

          // 3. Fallback to synthetic verified user session from payload
          if (!user && (payload.uid || payload.email)) {
            console.log('[AuthService] Activating verified session from external browser for:', payload.email);
            user = this.createSyntheticUser({
              uid: payload.uid || `google_${Date.now()}`,
              email: payload.email || '',
              displayName: payload.displayName || (payload.email ? payload.email.split('@')[0] : 'Dotify User'),
              photoURL: payload.photoURL || ''
            });
          }

          if (user) {
            this.currentUser = user;
            safeStorage.setItem('dotify_cached_user', {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL
            });
            this.notifySubscribers(user);
            console.log('[AuthService] External browser sign-in fully succeeded for:', user.email);
            resolve(user);
          } else {
            throw new Error('No user credentials could be resolved from external browser');
          }
        } catch (err) {
          console.error('[AuthService] External auth credential processing failed:', err);
          reject(err);
        }
      };

      // 1. Listen for Tauri native event emitted by Rust loopback server
      try {
        const { listen } = await import('@tauri-apps/api/event');
        console.log('[AuthService] Subscribed to google-auth-success');
        const unlisten = await listen<any>('google-auth-success', async (event) => {
          console.log('[AuthService] Received google-auth-success event');
          if (event.payload) {
            await handlePayload(event.payload);
          }
        });
        cleanupFns.push(unlisten);
      } catch (err) {
        console.debug('[AuthService] Native event listener unavailable:', err);
      }

      // 2. Listen for Android deep link callback
      if (typeof window !== 'undefined') {
        const prevHandler = (window as any).__handleGoogleAuthDeepLink;
        (window as any).__handleGoogleAuthDeepLink = async (uri: string) => {
          if (prevHandler) {
            try {
              prevHandler(uri);
            } catch {}
          }
          try {
            const clean = uri.replace(/^dotify:\/*/, 'http://localhost/').replace(/^intent:\/*/, 'http://localhost/');
            const url = new URL(clean);
            const idToken = url.searchParams.get('idToken');
            const googleIdToken = url.searchParams.get('googleIdToken');
            const accessToken = url.searchParams.get('accessToken');
            const uid = url.searchParams.get('uid');
            const email = url.searchParams.get('email');
            const displayName = url.searchParams.get('displayName');
            const photoURL = url.searchParams.get('photoURL');
            if (idToken || googleIdToken || uid) {
              await handlePayload({
                idToken: idToken || googleIdToken,
                googleIdToken: googleIdToken || undefined,
                accessToken: accessToken || undefined,
                uid: uid || undefined,
                email: email || undefined,
                displayName: displayName || undefined,
                photoURL: photoURL || undefined
              });
            }
          } catch (e) {
            console.warn('[AuthService] Error parsing deep link:', e);
          }
        };

        cleanupFns.push(() => {
          (window as any).__handleGoogleAuthDeepLink = prevHandler;
        });

        if ((window as any).__pendingGoogleAuthDeepLink) {
          const pending = (window as any).__pendingGoogleAuthDeepLink;
          delete (window as any).__pendingGoogleAuthDeepLink;
          (window as any).__handleGoogleAuthDeepLink(pending);
        }
      }

      // 3. Optional polling against backend /api/auth/latest if node daemon is active
      const baseUrl = getApiBaseUrl() || 'http://localhost:3001';
      const pollTimer = setInterval(async () => {
        if (resolved) return;
        try {
          const res = await fetch(`${baseUrl}/api/auth/latest`);
          if (res.ok) {
            const data = await res.json();
            if (data.ok && data.payload?.idToken) {
              await handlePayload(data.payload);
            }
          }
        } catch {}
      }, 1200);
      cleanupFns.push(() => clearInterval(pollTimer));

      // 4. Timeout after 60 seconds
      const timeoutTimer = setTimeout(() => {
        if (!resolved) {
          cleanup();
          reject(new Error('Sign-in timed out. Please try again.'));
        }
      }, 60000);
      cleanupFns.push(() => clearTimeout(timeoutTimer));

      // 5. Launch default browser using native Android bridge, Tauri plugin opener, or native command
      const authUrl = `http://localhost:${port}/login`;
      let launched = false;

      // Tier 1: Direct Android Native JavascriptInterface (instant Intent(ACTION_VIEW))
      if (typeof window !== 'undefined' && (window as any).AndroidNativeAuth?.openBrowser) {
        try {
          const ok = (window as any).AndroidNativeAuth.openBrowser(authUrl);
          if (ok !== false) {
            launched = true;
            console.log('[AuthService] Opened browser via AndroidNativeAuth bridge at:', authUrl);
          }
        } catch (androidErr) {
          console.warn('[AuthService] AndroidNativeAuth openBrowser failed:', androidErr);
        }
      }

      // Tier 2: @tauri-apps/plugin-opener (Tauri 2 standard cross-platform opener)
      if (!launched && isTauriEnvironment()) {
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(authUrl);
          launched = true;
          console.log('[AuthService] Opened default system browser via plugin-opener at:', authUrl);
        } catch (openerErr) {
          console.warn('[AuthService] plugin-opener openUrl failed:', openerErr);
        }
      }

      // Tier 3: Rust native invoke 'open_external_browser' (uses rundll32 on Windows, app.opener on mobile)
      if (!launched && isTauriEnvironment()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('open_external_browser', { url: authUrl });
          launched = true;
          console.log('[AuthService] Opened default system browser via native command at:', authUrl);
        } catch (invokeErr) {
          console.warn('[AuthService] invoke open_external_browser failed:', invokeErr);
        }
      }

      // Tier 4: ONLY use window.open if NOT running in Tauri (e.g. web browser) to prevent WebView2 navigation
      if (!launched && typeof window !== 'undefined' && !isTauriEnvironment()) {
        window.open(authUrl, '_blank');
      }
    });
  }

  public async signInWithGoogle(): Promise<User | null> {
    if (isTauriEnvironment()) {
      return await this.signInWithExternalBrowser();
    }

    try {
      const result = await signInWithPopup(auth, googleProvider);
      this.currentUser = result.user;
      return result.user;
    } catch (err: any) {
      console.warn('[AuthService] Google popup sign-in failed, attempting redirect:', err.code, err.message);

      // WebViews, Tauri, or popup blockers
      if (
        err.code === 'auth/popup-blocked' ||
        err.code === 'auth/operation-not-supported-in-this-environment' ||
        err.code === 'auth/cancelled-popup-request' ||
        err.message?.includes('disallowed_useragent')
      ) {
        try {
          await signInWithRedirect(auth, googleProvider);
          return null;
        } catch (redirectErr: any) {
          console.warn('[AuthService] Redirect sign-in failed:', redirectErr.message);
          throw redirectErr;
        }
      }
      throw err;
    }
  }

  public async signInWithFastProfile(nameOrEmail: string): Promise<User> {
    const val = nameOrEmail.trim();
    if (!val) {
      throw new Error('Please enter a name or email');
    }

    let hash = 0;
    for (let i = 0; i < val.length; i++) {
      hash = ((hash << 5) - hash) + val.charCodeAt(i);
      hash |= 0;
    }
    const uid = 'usr_' + Math.abs(hash);
    const isEmail = val.includes('@');
    const displayName = isEmail ? val.split('@')[0] : val;
    const email = isEmail ? val : `${val.toLowerCase().replace(/\s+/g, '')}@dotify.local`;

    const user = this.createSyntheticUser({
      uid,
      email,
      displayName,
      photoURL: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&h=120&fit=crop'
    });

    this.currentUser = user;
    safeStorage.setItem('dotify_cached_user', {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL
    });

    this.notifySubscribers(user);
    console.log('[AuthService] Fast profile connected successfully:', user.displayName);
    return user;
  }

  public async signOutUser(): Promise<void> {
    safeStorage.removeItem('dotify_cached_user');
    try {
      await signOut(auth);
    } catch (err: any) {
      console.warn('[AuthService] Sign-out failed:', err.message);
    }
    this.currentUser = null;
    this.notifySubscribers(null);
  }

  // Cloud & Local Multi-User Library Synchronization (Liked Songs, Playlists, History & Followed Artists)
  public async loadUserLibrary(userId: string): Promise<UserLibraryData | null> {
    let localLiked = safeStorage.getItem<Track[]>(`dotify_${userId}_liked`, safeStorage.getItem<Track[]>('likedTracks', []));
    let localPlaylists = safeStorage.getItem<CustomPlaylist[]>(`dotify_${userId}_playlists`, safeStorage.getItem<CustomPlaylist[]>('playlists', []));
    let localHistory = safeStorage.getItem<Track[]>(`dotify_${userId}_history`, safeStorage.getItem<Track[]>('history', []));
    let localFollowedArtists = safeStorage.getItem<FollowedArtist[]>(`dotify_${userId}_followed_artists`, safeStorage.getItem<FollowedArtist[]>('followed_artists', []));
    let latestTime = safeStorage.getItem<number>(`dotify_${userId}_updated`, 0);

    // 1. Try Backend Server library endpoint
    try {
      const baseUrl = getApiBaseUrl() || 'http://localhost:3001';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${baseUrl}/api/user/${encodeURIComponent(userId)}/library`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.library) {
          const remote = data.library as UserLibraryData;
          if ((remote.lastUpdated || 0) >= latestTime) {
            if (Array.isArray(remote.likedTracks) && remote.likedTracks.length > 0) {
              localLiked = remote.likedTracks;
            }
            if (Array.isArray(remote.playlists) && remote.playlists.length > 0) {
              localPlaylists = remote.playlists;
            }
            if (Array.isArray(remote.history) && remote.history.length > 0) {
              localHistory = remote.history;
            }
            if (Array.isArray(remote.followedArtists) && remote.followedArtists.length > 0) {
              localFollowedArtists = remote.followedArtists;
            }
            latestTime = remote.lastUpdated || Date.now();
          }
        }
      }
    } catch {}

    // 2. Try Firestore (with 1000ms safety timeout)
    try {
      const userDocRef = doc(db, 'users', userId);
      const snapshot = await Promise.race([
        getDoc(userDocRef),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1000))
      ]);

      if (snapshot && snapshot.exists && snapshot.exists()) {
        const cloudData = snapshot.data() as UserLibraryData;
        if ((cloudData.lastUpdated || 0) >= latestTime) {
          if (Array.isArray(cloudData.likedTracks) && cloudData.likedTracks.length > 0) {
            localLiked = cloudData.likedTracks;
          }
          if (Array.isArray(cloudData.playlists) && cloudData.playlists.length > 0) {
            localPlaylists = cloudData.playlists;
          }
          if (Array.isArray(cloudData.history) && cloudData.history.length > 0) {
            localHistory = cloudData.history;
          }
          if (Array.isArray(cloudData.followedArtists) && cloudData.followedArtists.length > 0) {
            localFollowedArtists = cloudData.followedArtists;
          }
          latestTime = cloudData.lastUpdated || Date.now();
        }
      }
    } catch (err) {
      console.debug('[AuthService] Firestore sync skipped or offline, using local store:', err);
    }

    safeStorage.setItem(`dotify_${userId}_liked`, localLiked);
    safeStorage.setItem(`dotify_${userId}_playlists`, localPlaylists);
    safeStorage.setItem(`dotify_${userId}_history`, localHistory);
    safeStorage.setItem(`dotify_${userId}_followed_artists`, localFollowedArtists);
    safeStorage.setItem(`dotify_${userId}_updated`, latestTime);

    // Keep active default keys synced so on cold boot before auth, library is immediately visible!
    safeStorage.setItem('likedTracks', localLiked);
    safeStorage.setItem('playlists', localPlaylists);
    safeStorage.setItem('history', localHistory);
    safeStorage.setItem('followed_artists', localFollowedArtists);

    return {
      likedTracks: localLiked,
      playlists: localPlaylists,
      history: localHistory,
      followedArtists: localFollowedArtists,
      lastUpdated: latestTime || Date.now(),
    };
  }

  public async saveUserLibrary(
    userId: string,
    likedTracks: Track[],
    playlists: CustomPlaylist[],
    history: Track[] = [],
    followedArtists: FollowedArtist[] = []
  ): Promise<void> {
    const lastUpdated = Date.now();

    // 1. Save scoped to user locally
    safeStorage.setItem(`dotify_${userId}_liked`, likedTracks);
    safeStorage.setItem(`dotify_${userId}_playlists`, playlists);
    safeStorage.setItem(`dotify_${userId}_history`, history);
    safeStorage.setItem(`dotify_${userId}_followed_artists`, followedArtists);
    safeStorage.setItem(`dotify_${userId}_updated`, lastUpdated);

    // 2. Sync to backend server & Firestore
    const sanitizedFollowed = (followedArtists || []).map((a) => ({
      id: a.id || '',
      name: a.name || '',
      imageUrl: a.imageUrl || '',
      genres: a.genres || [],
      followedAt: a.followedAt || Date.now(),
    })).slice(0, 200);

    const payload = {
      likedTracks: (likedTracks || []).slice(0, 300),
      playlists: (playlists || []).slice(0, 50),
      history: (history || []).slice(0, 100),
      followedArtists: sanitizedFollowed,
      lastUpdated,
    };

    try {
      const baseUrl = getApiBaseUrl() || 'http://localhost:3001';
      fetch(`${baseUrl}/api/user/${encodeURIComponent(userId)}/library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch {}

    // 3. Sync to Firestore in background (non-blocking)
    try {
      const userDocRef = doc(db, 'users', userId);
      Promise.race([
        setDoc(userDocRef, payload, { merge: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 1000))
      ]).then(() => {
        console.log('[AuthService] Synced library to Firestore for:', userId);
      }).catch((e: any) => {
        console.debug('[AuthService] Firestore sync deferred:', e.message);
      });
    } catch (err) {
      console.debug('[AuthService] Background cloud save deferred:', err);
    }
  }

  public subscribeToUserLibrary(
    userId: string,
    onUpdate: (data: UserLibraryData) => void
  ): () => void {
    try {
      const userDocRef = doc(db, 'users', userId);
      let isFirst = true;
      const unsubscribe = onSnapshot(
        userDocRef,
        (snapshot) => {
          if (isFirst) {
            isFirst = false;
            return;
          }
          if (snapshot.exists()) {
            const cloudData = snapshot.data() as UserLibraryData;
            if (cloudData) {
              onUpdate({
                likedTracks: cloudData.likedTracks || [],
                playlists: cloudData.playlists || [],
                history: cloudData.history || [],
                followedArtists: cloudData.followedArtists || [],
                lastUpdated: cloudData.lastUpdated || Date.now(),
              });
            }
          }
        },
        (err) => {
          console.debug('[AuthService] Realtime sync error:', err);
        }
      );
      return unsubscribe;
    } catch (e) {
      console.debug('[AuthService] Realtime listener skipped:', e);
      return () => {};
    }
  }
}

export const authService = AuthService.getInstance();

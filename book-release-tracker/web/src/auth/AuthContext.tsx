import type { User, UserManager } from "oidc-client-ts";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CALLBACK_PATH, randomNonce } from "./userManager";

export type AuthStatus =
  | { status: "loading" }
  | { status: "signedOut"; error?: string }
  | { status: "signedIn"; user: User };

interface AuthValue {
  auth: AuthStatus;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** A current access token for our API, or null if not signed in. */
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthValue | null>(null);

// React StrictMode runs effects twice in development. The callback must only be
// processed once (its state entry is deleted after use), so share one promise.
let callbackOnce: Promise<User> | null = null;

export function AuthProvider({ manager, children }: { manager: UserManager; children: ReactNode }) {
  const [auth, setAuth] = useState<AuthStatus>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const set = (a: AuthStatus) => {
      if (!cancelled) setAuth(a);
    };

    (async () => {
      if (window.location.pathname === CALLBACK_PATH) {
        try {
          // Checks state, exchanges the code (+ code_verifier) for tokens and
          // checks the ID token's nonce against the one we stored.
          callbackOnce ??= manager.signinRedirectCallback();
          const user = await callbackOnce;
          window.history.replaceState({}, "", "/"); // drop ?code=&state= from the address bar
          set({ status: "signedIn", user });
        } catch (err) {
          window.history.replaceState({}, "", "/");
          set({ status: "signedOut", error: err instanceof Error ? err.message : "Sign-in failed" });
        }
        return;
      }
      const user = await manager.getUser();
      set(user && !user.expired ? { status: "signedIn", user } : { status: "signedOut" });
    })();

    const onLoaded = (user: User) => set({ status: "signedIn", user });
    const onSignedOut = () => set({ status: "signedOut" });
    manager.events.addUserLoaded(onLoaded);
    manager.events.addUserUnloaded(onSignedOut);
    manager.events.addSilentRenewError(onSignedOut);
    return () => {
      cancelled = true;
      manager.events.removeUserLoaded(onLoaded);
      manager.events.removeUserUnloaded(onSignedOut);
      manager.events.removeSilentRenewError(onSignedOut);
    };
  }, [manager]);

  const signIn = useCallback(() => manager.signinRedirect({ nonce: randomNonce() }), [manager]);

  const signOut = useCallback(async () => {
    await manager.removeUser(); // clear tokens locally first, even if the redirect fails
    await manager.signoutRedirect();
  }, [manager]);

  const getAccessToken = useCallback(async () => {
    let user = await manager.getUser();
    if (user?.expired) {
      user = await manager.signinSilent().catch(() => null);
    }
    return user && !user.expired ? user.access_token : null;
  }, [manager]);

  const value = useMemo(() => ({ auth, signIn, signOut, getAccessToken }), [auth, signIn, signOut, getAccessToken]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth() must be used inside <AuthProvider>");
  return value;
}

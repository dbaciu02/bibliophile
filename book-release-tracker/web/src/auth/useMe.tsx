import { createContext, useContext, type ReactNode } from "react";
import { parseMe, type Me } from "../api/schemas";
import { useRemote, type RemoteState } from "../useRemote";
import { useAuth } from "./AuthContext";

/**
 * Who the API says the signed-in user is (GET /api/me), shared by the header,
 * the nav and the pages. Roles here only decide what to SHOW; the server
 * enforces them on every request regardless.
 */
const MeContext = createContext<{ me: RemoteState<Me> | null; retry: () => void }>({ me: null, retry: () => {} });

function SignedInMe({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth();
  const { state, retry } = useRemote("/api/me", parseMe, { getToken: getAccessToken });
  return <MeContext.Provider value={{ me: state, retry }}>{children}</MeContext.Provider>;
}

export function MeProvider({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  if (auth.status !== "signedIn") {
    return <MeContext.Provider value={{ me: null, retry: () => {} }}>{children}</MeContext.Provider>;
  }
  // keyed on the account so a different user gets a fresh request
  return <SignedInMe key={auth.user.profile.sub}>{children}</SignedInMe>;
}

export function useMe() {
  return useContext(MeContext);
}

export function hasRole(me: RemoteState<Me> | null, role: string): boolean {
  return me?.status === "ready" && me.data.roles.includes(role);
}

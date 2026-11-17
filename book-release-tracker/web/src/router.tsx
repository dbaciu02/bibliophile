import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

/**
 * A deliberately tiny router: the app has three pages, so a library would be
 * more code to explain than this. Real paths (not #hash) so each page and each
 * search has a shareable URL that the CDN can cache (step 8).
 */

const CHANGE = "app:navigate";

export function navigate(to: string, { replace = false } = {}): void {
  if (replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  window.dispatchEvent(new Event(CHANGE));
}

/** The current location (path + query), updated on navigate() and Back/Forward. */
export function useLocation(): { path: string; search: URLSearchParams } {
  const read = () => ({ path: window.location.pathname, search: new URLSearchParams(window.location.search) });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const update = () => setLoc(read());
    window.addEventListener(CHANGE, update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener(CHANGE, update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return loc;
}

/** An <a> that navigates without a full page reload (Cmd/Ctrl-click still opens a new tab). */
export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}

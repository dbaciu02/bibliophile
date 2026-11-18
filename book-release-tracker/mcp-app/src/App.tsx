import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { CalendarView, type FollowCall } from "./CalendarView";
import { Calendar, parseResult, type ToolResultLike } from "./result";

type View = { kind: "waiting" } | { kind: "error"; message: string } | { kind: "ready"; calendar: Calendar };

/**
 * Connects to the MCP host. The host runs show_release_calendar, then pushes
 * the arguments (ontoolinput) and the result (ontoolresult) into this iframe.
 * Every later action (changing the range, following an author) is a tool
 * call that the host proxies to the Bibliophile server with the user's own
 * token: the app never sees or stores a token.
 */
export function App() {
  const [view, setView] = useState<View>({ kind: "waiting" });
  const [months, setMonths] = useState(3);
  const [loading, setLoading] = useState(false);

  const show = (r: ToolResultLike) => {
    const parsed = parseResult(Calendar, r);
    setView(parsed.ok ? { kind: "ready", calendar: parsed.value } : { kind: "error", message: parsed.message });
  };

  const { app, error } = useApp({
    appInfo: { name: "Bibliophile release calendar", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (created) => {
      created.ontoolinput = ({ arguments: args }) => {
        if (typeof args?.months === "number") setMonths(args.months);
      };
      created.ontoolresult = (result) => show(result);
      created.ontoolcancelled = () => setView({ kind: "error", message: "The calendar request was cancelled." });
    },
  });
  useHostStyles(app, app?.getHostContext());

  if (error) return <p role="alert">Couldn't connect to the host: {error.message}</p>;
  if (view.kind === "waiting") return <p aria-live="polite">Loading the release calendar…</p>;
  if (view.kind === "error") return <p role="alert">{view.message}</p>;

  const { filters } = view.calendar;
  const filterArgs = {
    ...(filters.author ? { author: filters.author } : {}),
    ...(filters.category ? { category: filters.category } : {}),
  };

  const changeMonths = async (m: number) => {
    if (!app) return;
    setMonths(m);
    setLoading(true);
    try {
      show(await app.callServerTool({ name: "show_release_calendar", arguments: { ...filterArgs, months: m } }));
    } catch (err) {
      setView({ kind: "error", message: `Couldn't reload: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setLoading(false);
    }
  };

  const follow: FollowCall = async (authorName, confirmationToken) => {
    if (!app) return { isError: true, content: [{ type: "text", text: "Not connected." }] };
    return app.callServerTool({
      name: "add_to_watchlist",
      arguments: confirmationToken ? { authorName, confirmationToken } : { authorName },
    });
  };

  return <CalendarView calendar={view.calendar} months={months} onMonthsChange={(m) => void changeMonths(m)} loading={loading} follow={follow} />;
}

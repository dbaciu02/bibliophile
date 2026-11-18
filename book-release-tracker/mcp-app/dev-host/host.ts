/**
 * Minimal MCP Apps host, for local testing of the release calendar against
 * the real Bibliophile MCP server (npm run host --workspace mcp-app).
 * It does what a real host (Claude, VS Code, …) does, in the same order:
 *   1. list tools; find the ui:// resource on show_release_calendar
 *   2. read that resource (HTML + CSP)
 *   3. render it in a sandboxed iframe with that CSP
 *   4. send the tool input + result to the app, and proxy the app's own
 *      tool calls to the server with the user's token
 */
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = (s: string) => ($("status").textContent = s);
const log = (line: string) => {
  const el = $("log");
  el.textContent += `${new Date().toLocaleTimeString()} ${line}\n`;
  el.scrollTop = el.scrollHeight;
};
const redact = (args: unknown) =>
  JSON.stringify(args, (k, v) => (k === "confirmationToken" ? "[redacted]" : v));

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  void run().catch((err: unknown) => status(`Failed: ${err instanceof Error ? err.message : String(err)}`));
});

async function run() {
  const token = ($("token") as HTMLTextAreaElement).value.trim();
  const author = ($("author") as HTMLInputElement).value.trim();
  const months = Number(($("months") as HTMLInputElement).value) || 3;
  const args = { months, ...(author ? { author } : {}) };

  status("Connecting…");
  const client = new Client({ name: "bibliophile-dev-host", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/mcp", location.href), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );

  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === "show_release_calendar");
  const meta = tool?._meta as { ui?: { resourceUri?: string } } | undefined;
  const uri = meta?.ui?.resourceUri;
  if (!uri) throw new Error("show_release_calendar has no ui:// resource");

  const { contents } = await client.readResource({ uri });
  const res = contents[0] as { text?: string; mimeType?: string; _meta?: { ui?: { csp?: { resourceDomains?: string[] } } } };
  if (!res?.text || res.mimeType !== "text/html;profile=mcp-app") throw new Error(`Unexpected resource ${res?.mimeType}`);
  const imgDomains = res._meta?.ui?.csp?.resourceDomains ?? [];
  log(`resources/read ${uri} (${res.text.length} bytes, img-src ${imgDomains.join(" ") || "none"})`);

  // The app may run inline script/style (it is a single file) and load images
  // only from the domains it declared. No network access (connect-src 'none'):
  // everything goes through this host.
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src data: ${imgDomains.join(" ")}`,
    "connect-src 'none'",
  ].join("; ");
  const html = res.text.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);

  const stage = $("stage");
  stage.replaceChildren();
  const iframe = document.createElement("iframe");
  iframe.title = "Bibliophile release calendar (MCP App)";
  iframe.setAttribute("sandbox", "allow-scripts"); // opaque origin: no cookies, no storage, no parent DOM
  iframe.srcdoc = html;
  stage.append(iframe);

  const bridge = new AppBridge(
    null,
    { name: "Bibliophile dev host", version: "1.0.0" },
    { serverTools: {}, openLinks: {} },
    { hostContext: { theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", displayMode: "inline" } },
  );
  bridge.oncalltool = async (params) => {
    log(`app → tools/call ${params.name} ${redact(params.arguments)}`);
    const result = await client.callTool(params);
    const sc = result.structuredContent as { status?: string } | undefined;
    log(`   ← ${result.isError ? "isError" : (sc?.status ?? "ok")}`);
    return result as never;
  };
  bridge.onsizechange = ({ height }) => {
    if (height) iframe.style.height = `${Math.min(height + 4, 1200)}px`;
  };
  bridge.oninitialized = () => {
    void (async () => {
      await bridge.sendToolInput({ arguments: args });
      log(`host → tools/call show_release_calendar ${JSON.stringify(args)}`);
      const result = await client.callTool({ name: "show_release_calendar", arguments: args });
      log(`   ← ${result.isError ? "isError" : "ok"}`);
      await bridge.sendToolResult(result as never);
      status("App running.");
    })();
  };
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  status("Waiting for the app to start…");
}

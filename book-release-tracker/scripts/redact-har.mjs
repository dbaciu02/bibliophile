#!/usr/bin/env node
// Redacts a browser HAR recording of the login flow so it can be submitted as
// F7 evidence without leaking anything (hard gate 1).
//
//   node scripts/redact-har.mjs login-raw.har docs/evidence/login-flow.redacted.har
//
// KEPT (needed to prove the flow, single-use, useless after login):
//   client_id, redirect_uri, scope, response_type, response_mode, grant_type,
//   state, nonce, code_challenge, code_challenge_method, URLs, status codes.
// REDACTED:
//   every Authorization / Cookie / Set-Cookie header and every cookie value;
//   query/form values not on the keep list (code, code_verifier, tokens,
//   passwd, login, flowToken, ...); token fields in JSON responses; every
//   non-JSON response body (Microsoft's login pages embed session data).
//
// It then scans the result for anything shaped like a JWT and refuses to
// write the file if it finds one. Always open the output and check it yourself.

import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/redact-har.mjs <raw.har> <redacted.har>");
  process.exit(2);
}

const R = "[REDACTED]";
const KEEP_PARAMS = new Set([
  "client_id", "redirect_uri", "scope", "response_type", "response_mode", "grant_type",
  "state", "nonce", "code_challenge", "code_challenge_method", "post_logout_redirect_uri",
  "prompt", "x-client-sku", "x-client-ver",
]);
const SECRET_HEADERS = new Set(["authorization", "cookie", "set-cookie", "x-ms-refreshtokencredential"]);
const JSON_SECRET_KEY = /token|code|client_info|secret|password|passwd/i;

/** Redact query values in a URL string, keeping only KEEP_PARAMS. Also drops #fragments. */
function redactUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (!KEEP_PARAMS.has(key)) url.searchParams.set(key, R);
  }
  if (url.hash) url.hash = R;
  return url.toString();
}

function redactParams(params) {
  return params.map((p) => (KEEP_PARAMS.has(p.name) ? p : { ...p, value: R }));
}

function redactJson(value) {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, JSON_SECRET_KEY.test(k) && typeof v === "string" ? R : redactJson(v)]),
    );
  }
  return value;
}

function redactHeaders(headers) {
  return headers.map((h) => {
    const name = h.name.toLowerCase();
    if (SECRET_HEADERS.has(name)) return { ...h, value: R };
    if (name === "location" || name === "referer") return { ...h, value: redactUrl(h.value) };
    return h;
  });
}

const redactCookies = (cookies = []) => cookies.map((c) => ({ ...c, value: R }));

const har = JSON.parse(readFileSync(input, "utf8"));

for (const entry of har.log.entries) {
  const req = entry.request;
  req.url = redactUrl(req.url);
  req.headers = redactHeaders(req.headers);
  req.cookies = redactCookies(req.cookies);
  req.queryString = redactParams(req.queryString ?? []);
  if (req.postData) {
    if (req.postData.params) req.postData.params = redactParams(req.postData.params);
    const mime = req.postData.mimeType ?? "";
    if (mime.includes("application/x-www-form-urlencoded") && req.postData.text) {
      const form = new URLSearchParams(req.postData.text);
      for (const key of [...form.keys()]) if (!KEEP_PARAMS.has(key)) form.set(key, R);
      req.postData.text = form.toString();
    } else if (mime.includes("json") && req.postData.text) {
      try {
        req.postData.text = JSON.stringify(redactJson(JSON.parse(req.postData.text)));
      } catch {
        req.postData.text = R;
      }
    } else if (req.postData.text) {
      req.postData.text = R;
    }
  }

  const res = entry.response;
  res.headers = redactHeaders(res.headers);
  res.cookies = redactCookies(res.cookies);
  if (res.redirectURL) res.redirectURL = redactUrl(res.redirectURL);
  const content = res.content ?? {};
  if (content.text) {
    const isJson = (content.mimeType ?? "").includes("json") && content.encoding !== "base64";
    if (isJson) {
      try {
        content.text = JSON.stringify(redactJson(JSON.parse(content.text)));
      } catch {
        content.text = R;
      }
    } else {
      content.text = R;
      delete content.encoding;
    }
  }
}

const result = JSON.stringify(har, null, 2);

// Last line of defence: anything that still looks like a JWT (header.payload.sig)
// or a Microsoft refresh token means a field was missed.
const leaks = result.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g) ?? [];
if (leaks.length > 0) {
  console.error(`REFUSING to write ${output}: ${leaks.length} token-shaped value(s) still present.`);
  console.error("Nothing was written. Tell Claude which request they were in (not the values).");
  process.exit(1);
}

writeFileSync(output, result);
const entries = har.log.entries.length;
console.log(`Wrote ${output}: ${entries} requests, secrets redacted. Open it and check before committing.`);

import { useId, useState, type FormEvent } from "react";
import { apiRequest, type ApiResult, type FieldError } from "../api/request";
import { Release } from "../api/schemas";
import { useAuth } from "../auth/AuthContext";
import "./ReleaseEditor.css";

/**
 * Curator tools for releases typed in by hand (no Google Books involved):
 *
 *   <AddReleaseForm />          on the Curate page   -> POST   /api/releases
 *   <CuratorActions release />  on each release row  -> PATCH  /api/releases/:id
 *                                                     -> DELETE /api/releases/:id (hide)
 *
 * Shown only to curators, but that is convenience: the API checks the token,
 * scope and Curator role on every one of these calls (401/403 otherwise),
 * writes the audit row and sends the live event that updates open pages.
 * The form checks the obvious things first; the server's validation is the
 * real one, and its per-field messages are shown next to the fields.
 */

type Values = { title: string; authors: string; publishedDate: string; categories: string; thumbnailUrl: string };
type Field = keyof Values;
const EMPTY: Values = { title: "", authors: "", publishedDate: "", categories: "", thumbnailUrl: "" };

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** What the form holds -> the API's body. */
export function toBody(v: Values) {
  return {
    title: v.title.trim(),
    authors: list(v.authors),
    publishedDate: v.publishedDate.trim(),
    categories: list(v.categories),
    thumbnailUrl: v.thumbnailUrl.trim() || null,
  };
}

/** A release -> the form, with the date as precise as it is known ("2027", "2027-03" or "2027-03-15"). */
export function fromRelease(r: Release): Values {
  const date = r.datePrecision === "year" ? r.releaseDate.slice(0, 4) : r.datePrecision === "month" ? r.releaseDate.slice(0, 7) : r.releaseDate;
  return {
    title: r.title,
    authors: r.authors.join(", "),
    publishedDate: date,
    categories: r.categories.join(", "),
    thumbnailUrl: r.thumbnailUrl ?? "",
  };
}

/** Quick checks before sending; the server checks everything again. */
export function checkValues(v: Values): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (!v.title.trim()) e.title = "Enter a title.";
  if (list(v.authors).length === 0) e.authors = "Enter at least one author.";
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(v.publishedDate.trim())) e.publishedDate = "Not a date in one of the formats above.";
  const url = v.thumbnailUrl.trim();
  if (url && !url.startsWith("https://")) e.thumbnailUrl = "Leave it empty, or give an https:// image link.";
  return e;
}

/** The server's per-field messages ("authors.0" -> authors). */
function serverFieldErrors(details: FieldError[] | undefined): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  for (const d of details ?? []) {
    const field = d.path.split(".")[0] as Field;
    if (field in EMPTY && !e[field]) e[field] = d.message;
  }
  return e;
}

const parseRelease = (j: unknown) => Release.parse(j);

// ---------------------------------------------------------------- shared form

function ReleaseFields({
  values,
  errors,
  disabled,
  onChange,
}: {
  values: Values;
  errors: Partial<Record<Field, string>>;
  disabled: boolean;
  onChange: (k: Field, value: string) => void;
}) {
  const id = useId();
  const field = (k: Field, label: string, extra: { hint?: string; span?: boolean; type?: string; placeholder?: string } = {}) => {
    const inputId = `${id}-${k}`;
    const hintId = extra.hint ? `${inputId}-hint` : undefined;
    const errId = errors[k] ? `${inputId}-err` : undefined;
    return (
      <div className={extra.span ? "field span-2" : "field"}>
        <label htmlFor={inputId}>{label}</label>
        <input
          id={inputId}
          type={extra.type ?? "text"}
          value={values[k]}
          onChange={(e) => onChange(k, e.target.value)}
          disabled={disabled}
          placeholder={extra.placeholder}
          aria-invalid={errors[k] ? true : undefined}
          aria-describedby={[hintId, errId].filter(Boolean).join(" ") || undefined}
          maxLength={k === "thumbnailUrl" ? 2000 : 500}
        />
        {extra.hint && (
          <small id={hintId} className="muted">
            {extra.hint}
          </small>
        )}
        {errors[k] && (
          <small id={errId} className="error">
            {errors[k]}
          </small>
        )}
      </div>
    );
  };
  return (
    <div className="grid release-fields">
      {field("title", "Title", { span: true })}
      {field("authors", "Authors", { hint: "Separate several with commas" })}
      {field("publishedDate", "Release date", { hint: "2027, 2027-03 or 2027-03-15", placeholder: "2027-03-15" })}
      {field("categories", "Categories", { hint: "Optional, comma-separated", placeholder: "Fiction, Mystery" })}
      {field("thumbnailUrl", "Cover image link", { hint: "Optional, https only", type: "url", span: true })}
    </div>
  );
}

/** Form state + submit, shared by "add" and "edit". */
function useReleaseForm(initial: Values, send: (body: ReturnType<typeof toBody>) => Promise<ApiResult<Release>>) {
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  const onChange = (k: Field, value: string) => setValues((old) => ({ ...old, [k]: value }));

  const submit = async (onSaved: (r: Release) => void) => {
    const local = checkValues(values);
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setMessage({ kind: "error", text: "Check the highlighted fields." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await send(toBody(values));
    setBusy(false);
    if (result.ok) {
      onSaved(result.data);
    } else {
      setErrors(serverFieldErrors(result.details));
      setMessage({ kind: "error", text: result.requestId ? `${result.message} (reference ${result.requestId})` : result.message });
    }
  };

  return { values, setValues, errors, busy, message, setMessage, onChange, submit };
}

function Message({ message }: { message: { kind: "error" | "ok"; text: string } | null }) {
  if (!message) return null;
  return (
    <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "error" : "ok"}>
      {message.text}
    </p>
  );
}

// ---------------------------------------------------------------- add (Curate page)

export function AddReleaseForm() {
  const { getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const form = useReleaseForm(EMPTY, async (body) =>
    apiRequest("POST", "/api/releases", { token: await getAccessToken(), body, parse: parseRelease }),
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit((created) => {
      form.setValues(EMPTY);
      form.setMessage({ kind: "ok", text: `Added “${created.title}”. It’s on the releases page now.` });
    });
  };

  return (
    <section className="add-by-hand" aria-labelledby="add-by-hand">
      <h2 id="add-by-hand">
        <button type="button" className="link" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} Add a release by hand
        </button>
      </h2>
      {/* Rendered only when open, so its fields don't sit hidden next to the search form's. */}
      {open && (
        <form id={panelId} className="curate-form" onSubmit={onSubmit} noValidate aria-labelledby="add-by-hand">
          <p className="muted">For a book Google Books doesn’t have yet, or a made-up one for testing.</p>
          <ReleaseFields values={form.values} errors={form.errors} disabled={form.busy} onChange={form.onChange} />
          <div className="actions">
            <button type="submit" disabled={form.busy}>
              {form.busy ? "Adding…" : "Add release"}
            </button>
          </div>
          <Message message={form.message} />
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- edit / hide (release rows)

export function CuratorActions({ release, onChanged }: { release: Release; onChanged: () => void }) {
  const [mode, setMode] = useState<"idle" | "editing" | "confirmHide">("idle");
  const [hideState, setHideState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const { getAccessToken } = useAuth();

  const hide = async () => {
    setHideState({ busy: true, error: null });
    const result = await apiRequest("DELETE", `/api/releases/${release.id}`, { token: await getAccessToken() });
    if (result.ok || result.status === 404) {
      onChanged(); // 404: already hidden by someone else, same end state
    } else {
      setHideState({ busy: false, error: result.message });
    }
  };

  if (mode === "editing") {
    return <EditRelease release={release} onDone={() => setMode("idle")} onChanged={onChanged} />;
  }
  if (mode === "confirmHide") {
    return (
      <div className="curator-actions" role="group" aria-label={`Hide ${release.title}?`}>
        <span>Hide “{release.title}” from the catalog?</span>{" "}
        <button type="button" onClick={() => void hide()} disabled={hideState.busy}>
          {hideState.busy ? "Hiding…" : "Yes, hide it"}
        </button>{" "}
        <button type="button" className="secondary" onClick={() => setMode("idle")} disabled={hideState.busy}>
          Cancel
        </button>
        {hideState.error && (
          <p role="alert" className="error">
            {hideState.error}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="curator-actions">
      <button type="button" className="link" onClick={() => setMode("editing")} aria-label={`Edit ${release.title}`}>
        Edit
      </button>{" "}
      ·{" "}
      <button type="button" className="link" onClick={() => setMode("confirmHide")} aria-label={`Hide ${release.title}`}>
        Hide
      </button>
    </div>
  );
}

function EditRelease({ release, onDone, onChanged }: { release: Release; onDone: () => void; onChanged: () => void }) {
  const { getAccessToken } = useAuth();
  const form = useReleaseForm(fromRelease(release), async (body) =>
    apiRequest("PATCH", `/api/releases/${release.id}`, { token: await getAccessToken(), body, parse: parseRelease }),
  );
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(() => {
      onChanged();
      onDone();
    });
  };
  return (
    <form className="curate-form" onSubmit={onSubmit} noValidate aria-label={`Edit ${release.title}`}>
      <ReleaseFields values={form.values} errors={form.errors} disabled={form.busy} onChange={form.onChange} />
      <div className="actions">
        <button type="submit" disabled={form.busy}>
          {form.busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" onClick={onDone} disabled={form.busy}>
          Cancel
        </button>
      </div>
      <Message message={form.message} />
    </form>
  );
}

import { vi } from "vitest";

/**
 * Stand-in for the browser's EventSource so tests can play the server:
 * open(), send an event, drop the connection. Installed with installFakeEventSource().
 */
export class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  readyState = FakeEventSource.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }

  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** Like the server sending `id: …\nevent: …\ndata: …`. */
  emit(type: string, id: number, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data), lastEventId: String(id) }));
  }

  /** Connection lost; a real EventSource would now retry by itself. */
  drop() {
    this.readyState = FakeEventSource.CONNECTING;
    this.onerror?.(new Event("error"));
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

export function installFakeEventSource(): typeof FakeEventSource {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  return FakeEventSource;
}

export const lastSource = (): FakeEventSource => {
  const s = FakeEventSource.instances.at(-1);
  if (!s) throw new Error("no EventSource was created");
  return s;
};

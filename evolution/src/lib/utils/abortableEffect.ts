// Shared cleanup-guard for React useEffects that await Server Actions or other
// async work. Server Action POSTs cannot be cancelled from the client (the
// server keeps running), but we can:
//   (a) discard the response on unmount (guard setState with !cancelled)
//   (b) signal-aware downstream callers if a future API accepts AbortSignal.
// Establishes the project convention (no prior pattern existed across the
// evolution/ or src/ components — verified via grep on 2026-05-30).
//
// Usage:
//   useEffect(() => {
//     const ctl = abortableEffectController();
//     getThing().then(r => { if (!ctl.cancelled) setThing(r); });
//     return () => ctl.abort();
//   }, [deps]);

export type AbortableEffectController = {
  readonly signal: AbortSignal;
  readonly cancelled: boolean;
  abort: () => void;
};

export function abortableEffectController(): AbortableEffectController {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    get cancelled() {
      return controller.signal.aborted;
    },
    abort() {
      controller.abort();
    },
  };
}

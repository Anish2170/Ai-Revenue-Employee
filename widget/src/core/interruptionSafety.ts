export interface InterruptionSnapshot { blockedReason: string | null; version: number; formStalled: boolean }

const STALL_MS = 8_000;
const IDLE_MS = 12_000;
const MAX_STALL_MS = 30_000;

/** Current interaction state, independent of inferred historical sales intent.
 * No field values are read. Host integrations can report an actual conversion
 * via `aire:conversion` with {status:'success'|'in_progress'|'error'}.
 */
export class InterruptionSafety {
  private version = 0;
  private lastActivity = Date.now();
  private lastInput = 0;
  private focusedAt = 0;
  private composing = false;
  private submitting = false;
  private converted = false;
  private chatOpen = false;
  private stableAt = Date.now() + 1000;
  private timer: ReturnType<typeof window.setTimeout> | null = null;
  private signature = '';
  private started = false;

  constructor(private readonly onChange: (snapshot: InterruptionSnapshot) => void = () => {}) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const name of ['pointerdown', 'pointermove', 'touchstart', 'scroll', 'keydown', 'focusin', 'focusout', 'input', 'change', 'compositionstart', 'compositionend', 'submit', 'visibilitychange', 'aire:conversion']) document.addEventListener(name, this.onEvent, true);
    this.schedule();
  }

  stop(): void {
    this.started = false;
    for (const name of ['pointerdown', 'pointermove', 'touchstart', 'scroll', 'keydown', 'focusin', 'focusout', 'input', 'change', 'compositionstart', 'compositionend', 'submit', 'visibilitychange', 'aire:conversion']) document.removeEventListener(name, this.onEvent, true);
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  navigate(): void {
    this.stableAt = Date.now() + 1000;
    this.lastActivity = Date.now();
    this.lastInput = 0; this.focusedAt = 0; this.composing = false;
    this.submitting = false; // Successful conversion remains sticky for this visit.
    this.invalidate();
  }

  renewSession(): void { this.converted = false; this.submitting = false; this.navigate(); }
  setChatOpen(open: boolean): void { if (this.chatOpen !== open) { this.chatOpen = open; this.invalidate(); } }

  snapshot(): InterruptionSnapshot {
    const now = Date.now();
    const active = deepActiveElement();
    const field = isEditable(active);
    const elapsed = now - Math.max(this.lastInput, this.focusedAt);
    const formStalled = field && !this.composing && this.focusedAt > 0 && elapsed >= STALL_MS && elapsed < MAX_STALL_MS;
    let blockedReason: string | null = null;
    if (this.converted || /(?:^|\/)(?:thank-you|thankyou|order-confirmation|booking-confirmed)(?:\/|$)/i.test(window.location.pathname)) blockedReason = 'converted';
    else if (this.chatOpen) blockedReason = 'chat_open';
    else if (document.visibilityState === 'hidden') blockedReason = 'hidden';
    else if (this.submitting) blockedReason = 'conversion_in_progress';
    else if (now < this.stableAt || document.readyState === 'loading') blockedReason = 'page_unstable';
    else if (hasCriticalInteraction(active)) blockedReason = 'critical_interaction';
    else if (this.composing || (this.lastInput > 0 && now - this.lastInput < 2000)) blockedReason = 'typing';
    else if (field && !formStalled) blockedReason = elapsed >= MAX_STALL_MS ? 'idle' : 'form_progress';
    else if (!formStalled && now - this.lastActivity >= IDLE_MS) blockedReason = 'idle';
    const signature = `${blockedReason ?? 'safe'}:${formStalled}`;
    if (this.signature && signature !== this.signature) this.version++;
    this.signature = signature;
    return { blockedReason, version: this.version, formStalled };
  }

  private invalidate(): void {
    this.version++;
    const snapshot = this.snapshot();
    if (this.started) this.onChange(snapshot);
    this.schedule();
  }

  private schedule(): void {
    if (!this.started) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    const now = Date.now();
    const boundaries = [this.stableAt, this.lastInput + 2000, this.lastActivity + IDLE_MS, Math.max(this.focusedAt, this.lastInput) + STALL_MS, Math.max(this.focusedAt, this.lastInput) + MAX_STALL_MS].filter(at => at > now);
    if (!boundaries.length) { this.timer = null; return; }
    this.timer = window.setTimeout(() => {
      this.timer = null;
      const before = this.version;
      const snapshot = this.snapshot();
      if (before !== snapshot.version) this.onChange(snapshot);
      this.schedule();
    }, Math.max(1, Math.min(...boundaries) - now));
  }

  private onEvent = (event: Event): void => {
    const target = event.composedPath?.()[0] as Element | undefined ?? event.target as Element | null;
    if (target?.closest?.('#ai-revenue-employee') || (event.target as Element | null)?.id === 'ai-revenue-employee') return;
    if (event.type === 'aire:conversion') {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status;
      if (status === 'success') this.converted = true;
      this.submitting = status === 'in_progress';
      this.invalidate(); return;
    }
    if (event.type === 'visibilitychange') { this.invalidate(); return; }
    this.lastActivity = Date.now();
    if (event.type === 'submit') { this.submitting = true; this.invalidate(); return; }
    if (event.type === 'focusin' && isEditable(target)) this.focusedAt = Date.now();
    if (event.type === 'compositionstart') this.composing = true;
    if (event.type === 'compositionend') this.composing = false;
    if ((event.type === 'input' || event.type === 'change' || event.type.startsWith('composition') || event.type === 'keydown') && isEditable(target)) this.lastInput = Date.now();
    if (['input', 'change', 'focusin', 'focusout', 'compositionstart', 'compositionend'].includes(event.type) || (event.type === 'keydown' && isEditable(target))) this.invalidate();
    else {
      const before = this.version, snapshot = this.snapshot();
      if (before !== snapshot.version) this.onChange(snapshot);
      this.schedule();
    }
  };
}

function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}
function isEditable(target: Element | null | undefined): boolean {
  return Boolean(target?.matches?.('input:not([type=button]):not([type=submit]):not([type=hidden]),textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox]'));
}
function hasCriticalInteraction(active: Element | null): boolean {
  if (/(?:^|\/)(?:checkout|payment|pay)(?:\/|$)/i.test(window.location.pathname)) return true;
  if (active?.matches?.('iframe,input[type=password],input[autocomplete^="cc-"]') || active?.closest?.('[data-aire-critical],form[action*="checkout"],form[action*="payment"]')) return true;
  // Native dialogs and accessible host modals, excluding the widget itself.
  const modals = document.querySelectorAll?.('dialog[open],[aria-modal=true],[data-aire-critical="active"]') ?? [];
  return Array.from(modals).some(node => !node.closest('#ai-revenue-employee') && !node.hasAttribute('hidden') && node.getAttribute('aria-hidden') !== 'true' && node.getClientRects().length > 0);
}

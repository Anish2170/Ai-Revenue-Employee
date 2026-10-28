import type { WidgetConfig, PopupDeliveryMetadata, PopupPageContext } from '../types.js';
import type { WidgetIdentity } from '../session/identity.js';

type Operation = 'displayed' | 'release' | 'clicked' | 'dismissed';
interface Receipt { operation: Operation; popupId: string; pageInstanceId: string; identity: WidgetIdentity; attempts: number }

/** Small bounded receipt outbox. No popup text/form values are persisted. */
export class PopupDelivery {
  private receipts: Receipt[] = [];
  private flushing = false;
  private loaded = false;
  private retryAt = 0;
  constructor(private readonly cfg: WidgetConfig) {}
  private get key(): string { return `aire-popup-receipts:${this.cfg.siteId}`; }

  resume(identity: WidgetIdentity): void {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const parsed: unknown = JSON.parse(sessionStorage.getItem(this.key) ?? '[]');
        if (Array.isArray(parsed)) this.receipts = parsed.slice(0, 12).filter((r): r is Receipt => Boolean(r && ['displayed','release','clicked','dismissed'].includes(r.operation) && typeof r.popupId === 'string' && typeof r.pageInstanceId === 'string' && r.identity?.sessionId === identity.sessionId && r.identity?.visitorToken === identity.visitorToken)).map(r => ({ ...r, attempts: 0 }));
      } catch { /* unavailable storage: in-document outbox still works */ }
    }
    // Session rollover must not leave an exhausted old outbox blocking a new
    // visit. Online/visible recovery starts at most one fresh bounded cycle.
    this.receipts = this.receipts.filter(r => r.identity.sessionId === identity.sessionId || r.attempts < 3);
    if (!this.flushing && Date.now() >= this.retryAt) {
      this.retryAt = Date.now() + 5000;
      for (const receipt of this.receipts) if (receipt.identity.sessionId === identity.sessionId) receipt.attempts = 0;
    }
    this.persist();
    void this.flush();
  }

  async claim(delivery: PopupDeliveryMetadata, identity: WidgetIdentity, context: PopupPageContext, signal?: AbortSignal): Promise<number | null> {
    try {
      const result = await this.request({ operation: 'claim', popupId: delivery.popupId, pageInstanceId: delivery.pageInstanceId, context }, identity, signal);
      return result?.ok && typeof result.claimUntil === 'number' ? result.claimUntil : null;
    } catch { return null; }
  }

  context(identity: WidgetIdentity, context: PopupPageContext): void {
    void this.request({ operation: 'context', pageInstanceId: context.pageInstanceId, context }, identity).catch(() => {});
  }

  notify(operation: Operation, delivery: PopupDeliveryMetadata, identity: WidgetIdentity): void {
    if (this.receipts.some(r => r.popupId === delivery.popupId && r.operation === operation)) return;
    // At most two displays and six generations per server session.
    if (this.receipts.length >= 12) return;
    this.receipts.push({ operation, popupId: delivery.popupId, pageInstanceId: delivery.pageInstanceId, identity, attempts: 0 });
    this.persist();
    void this.flush();
  }

  private persist(): void { try { sessionStorage.setItem(this.key, JSON.stringify(this.receipts)); } catch { /* memory fallback */ } }
  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (true) {
        const receipt = this.receipts.find((r, index) => r.attempts < 3 && !this.receipts.slice(0, index).some(previous => previous.popupId === r.popupId));
        if (!receipt) return;
        receipt.attempts++;
        try {
          const result = await this.request({ operation: receipt.operation, popupId: receipt.popupId, pageInstanceId: receipt.pageInstanceId }, receipt.identity);
          if (!result) throw new Error('Receipt unavailable');
          // An explicit rejection (restart/expired identity) is terminal too.
          this.receipts = this.receipts.filter(r => r !== receipt);
        } catch {
          if (receipt.attempts < 3) await new Promise<void>(resolve => window.setTimeout(resolve, receipt.attempts === 1 ? 500 : 1500));
        }
        this.persist();
      }
    } finally { this.flushing = false; }
  }

  private async request(body: Record<string, unknown>, identity: WidgetIdentity, signal?: AbortSignal): Promise<{ ok: boolean; claimUntil?: number } | null> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof window.setTimeout> | null = null;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => { controller.abort(); reject(new Error('Popup receipt timeout')); }, 4000); });
      const work = (async () => {
        if (controller.signal.aborted) return null;
        const res = await fetch(`${this.cfg.backendUrl}/popup/lifecycle`, { method: 'POST', credentials: 'omit', keepalive: true, signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, siteId: this.cfg.siteId, visitorId: identity.visitorId, sessionId: identity.sessionId, visitorToken: identity.visitorToken }) });
        if (!res.ok) { if (res.status === 400 || res.status === 403) return { ok: false }; throw new Error('Lifecycle unavailable'); }
        const result = await res.json();
        return controller.signal.aborted ? null : result as { ok: boolean; claimUntil?: number };
      })();
      return await Promise.race([work, timeout]);
    } finally { if (timer !== null) window.clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}

/** Default-path navigation lifecycle, independent of the optional legacy Tracker. */
export function currentPageKey(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export class NavigationObserver {
  private key = currentPageKey();
  private started = false;
  private readonly restore: Array<() => void> = [];

  constructor(private readonly onChange: () => void) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method];
      const observer = this;
      const patched = function (this: History, ...args: Parameters<History[typeof method]>) {
        const result = original.apply(this, args);
        observer.check();
        return result;
      } as History[typeof method];
      history[method] = patched;
      this.restore.push(() => { if (history[method] === patched) history[method] = original; });
    }
    window.addEventListener('popstate', this.check);
    window.addEventListener('hashchange', this.check);
    window.addEventListener('pageshow', this.onPageShow);
  }

  stop(): void {
    this.started = false;
    for (const restore of this.restore.splice(0).reverse()) restore();
    window.removeEventListener('popstate', this.check);
    window.removeEventListener('hashchange', this.check);
    window.removeEventListener('pageshow', this.onPageShow);
  }

  private check = (): void => {
    const next = currentPageKey();
    if (next === this.key) return;
    this.key = next;
    this.onChange();
  };

  private onPageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted) return;
    this.key = currentPageKey();
    this.onChange();
  };
}

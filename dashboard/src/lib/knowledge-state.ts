// One owner for build identity, status polling and mutation response ordering.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RecordData = Record<string, any>;
export const activeBuild = (build: RecordData | null | undefined) => ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(build?.status);
export interface KnowledgeClient {
  getKnowledgeStatus(id: string): Promise<unknown>;
  getKnowledgeBuild(id: string, buildId: string): Promise<unknown>;
  queueKnowledgeBuild(id: string, url: string, budget: { maxPages: number; maxRenderedPages: number }): Promise<{ buildId: string; status: string }>;
  cancelKnowledgeBuild(id: string, buildId: string): Promise<unknown>;
}
export class KnowledgeState {
  value = { status: null as RecordData | null, loading: true, pending: false, cancelling: false, connectionLost: false, error: '', budgetProfile: '25:3' };
  private generation = 0;
  private stopped = false;
  private failures = 0;
  private budgetEdited = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private client: KnowledgeClient;
  private websiteId: string;
  private notify: () => void;
  private schedule: (fn: () => void) => ReturnType<typeof setTimeout>;
  private unschedule: (timer: ReturnType<typeof setTimeout> | undefined) => void;
  constructor(client: KnowledgeClient, websiteId: string, notify: () => void,
    schedule = (fn: () => void) => setTimeout(fn, 1500), unschedule = (timer: ReturnType<typeof setTimeout> | undefined) => clearTimeout(timer)) {
    this.client = client; this.websiteId = websiteId; this.notify = notify;
    this.schedule = schedule; this.unschedule = unschedule;
  }
  private emit() { this.value = { ...this.value }; this.notify(); }
  private begin() { this.generation++; this.unschedule(this.timer); this.timer = undefined; return this.generation; }
  private valid(generation: number) { return !this.stopped && generation === this.generation; }
  private adopt(build: RecordData | null) {
    this.value.status = { ...this.value.status, lastBuild: build };
    const budget = build?.configuration?.budget;
    if (!this.budgetEdited && budget) this.value.budgetProfile = `${budget.maxPages}:${budget.maxRenderedPages}`;
    if (build?.status === 'SUCCESS') this.value.error = '';
  }
  setBudget(profile: string) { this.budgetEdited = true; this.value.budgetProfile = profile; this.emit(); }
  private retry(generation: number, fn: () => Promise<void>) {
    if (this.valid(generation)) this.timer = this.schedule(() => { this.timer = undefined; void fn(); });
  }
  async refresh() {
    const generation = this.begin(); this.failures = 0;
    await this.load(generation);
  }
  private async load(generation: number) {
    try {
      const status = await this.client.getKnowledgeStatus(this.websiteId) as RecordData;
      if (!this.valid(generation)) return;
      this.value.status = status; this.adopt(status.lastBuild); this.value.connectionLost = false; this.failures = 0;
      if (activeBuild(status.lastBuild)) this.retry(generation, () => this.poll(generation, status.lastBuild.id));
    } catch {
      if (!this.valid(generation)) return;
      this.value.connectionLost = true;
      if (++this.failures <= 3) this.retry(generation, () => this.load(generation));
    } finally { if (this.valid(generation)) { this.value.loading = false; this.emit(); } }
  }
  private async poll(generation: number, id: string) {
    try {
      const build = await this.client.getKnowledgeBuild(this.websiteId, id) as RecordData;
      if (!this.valid(generation)) return;
      this.adopt(build); this.value.connectionLost = false; this.failures = 0; this.emit();
      if (activeBuild(build)) this.retry(generation, () => this.poll(generation, id));
      else await this.load(generation); // Refresh the published snapshot only after a terminal job.
    } catch {
      if (!this.valid(generation)) return;
      this.value.connectionLost = true; this.emit();
      if (++this.failures <= 3) this.retry(generation, () => this.poll(generation, id));
    }
  }
  async start(url: string) {
    if (this.value.pending || activeBuild(this.value.status?.lastBuild)) return;
    const generation = this.begin(); this.failures = 0;
    this.value.pending = true; this.value.error = ''; this.value.connectionLost = false;
    this.adopt(null); this.emit();
    try {
      const [maxPages, maxRenderedPages] = this.value.budgetProfile.split(':').map(Number);
      const queued = await this.client.queueKnowledgeBuild(this.websiteId, url, { maxPages, maxRenderedPages });
      if (!this.valid(generation)) return;
      this.adopt({ id: queued.buildId, status: queued.status, phase: 'queued', createdAt: new Date().toISOString(), configuration: { budget: { maxPages, maxRenderedPages } } });
      this.value.pending = false; this.emit();
      await this.poll(generation, queued.buildId);
    } catch (error) {
      if (!this.valid(generation)) return;
      this.value.pending = false; this.value.error = error instanceof Error ? error.message : 'Unable to start build.'; this.emit();
      await this.load(generation); // A timed-out POST may still have queued a durable job.
    }
  }
  async queued(buildId: string, status: string) {
    const generation = this.begin(); this.failures = 0; this.value.error = '';
    this.adopt({ id: buildId, status, phase: 'queued' }); this.emit();
    await this.poll(generation, buildId);
  }
  async cancel() {
    const build = this.value.status?.lastBuild;
    if (!activeBuild(build) || this.value.cancelling) return;
    const generation = this.begin(); this.failures = 0;
    this.value.cancelling = true; this.value.error = ''; this.emit();
    try {
      await this.client.cancelKnowledgeBuild(this.websiteId, build.id);
      if (!this.valid(generation)) return;
      // Read the actual outcome: publication may have won the race against cancel.
      await this.poll(generation, build.id);
    } catch (error) {
      if (!this.valid(generation)) return;
      this.value.error = error instanceof Error ? error.message : 'Unable to cancel build.';
      await this.poll(generation, build.id);
    } finally { if (this.valid(generation)) { this.value.cancelling = false; this.emit(); } }
  }
  stop() { this.stopped = true; this.begin(); }
}

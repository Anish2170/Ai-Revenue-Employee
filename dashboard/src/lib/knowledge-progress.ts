export interface BuildProgressState {
  configuration?: { approval?: { inventory: Array<{ disposition: string; url: string }> } } | null;
  status: string;
  coverage?: { completeWithinScope?: boolean; discovered?: number; attempted?: number; fetched?: number; useful?:number; rendered?:number; duplicates?:number; skipped?:number; failed?: number; limits?: string[]; scope?:string; missingCategories?:string[] } | null;
  phase?: string;
  progress?: Record<string, number | null | undefined>;
  attempt?: number;
  maxAttempts?: number;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export const BUILD_STEPS = [
  { phase: 'crawling', label: 'Read pages' },
  { phase: 'action_discovery', label: 'Find actions' },
  { phase: 'chunking', label: 'Prepare text' },
  { phase: 'embedding', label: 'Create embeddings' },
  { phase: 'indexing', label: 'Index knowledge' },
  { phase: 'saving', label: 'Save knowledge' },
];

/** Stage weights are estimates, not a claim about time remaining. */
export function describeBuildProgress(build: BuildProgressState) {
  const p = build.progress ?? {};
  const ratio = (done: number | null | undefined, total: number | null | undefined) => total && total > 0 ? Math.min(1, Math.max(0, (done ?? 0) / total)) : 0;
  const step = BUILD_STEPS.findIndex(s => s.phase === build.phase);
  let percent = 0;
  let title = 'Waiting to start';
  let description = 'Your build is queued and will start when a worker is available.';
  switch (build.phase) {
    case 'starting': percent = 1; title = 'Starting your build'; description = 'Preparing the website knowledge build.'; break;
    case 'crawling': percent = 2 + Math.floor(28 * ratio(p.pages, p.crawlLimit)); title = 'Reading website pages'; description = `${p.pages ?? 0} pages read${p.pagesSkipped ? ` · ${p.pagesSkipped} skipped` : ''}. Following links to discover more content.`; break;
    case 'action_discovery': percent = 30 + Math.floor(40 * ratio(p.actionsCompleted, p.actionsTotal)); title = 'Finding website actions'; description = p.actionsTotal != null ? `Checked ${p.actionsCompleted ?? 0} of ${p.actionsTotal} action candidates. Reusing matching classifications.` : 'Checking links and buttons for useful visitor actions.'; break;
    case 'chunking': percent = 72; title = 'Preparing knowledge text'; description = `Organizing content from ${p.pages ?? 0} pages into searchable chunks.`; break;
    case 'embedding': percent = 75 + Math.floor(17 * ratio(p.embeddingsCompleted, p.chunks)); title = 'Creating embeddings'; description = `Sending ${p.chunks ?? 0} chunks to the embedding model${p.embeddingsCompleted != null ? ` · ${p.embeddingsCompleted} completed` : '. Waiting for the model response'}.`; break;
    case 'indexing': percent = 94; title = 'Indexing knowledge'; description = 'Building the search index for your website content.'; break;
    case 'saving': percent = 98; title = 'Saving your knowledge base'; description = 'Saving the knowledge snapshot and publishing it for your assistant.'; break;
  }
  if (build.status === 'SUCCESS') { percent = 100; title = 'Knowledge base ready'; description = `${p.pages ?? 0} pages and ${p.chunks ?? 0} chunks published for this crawl scope. This is not a claim that the entire website was understood.`; }
  if (build.status === 'RETRY_WAIT') { percent = 0; title = 'Waiting to retry'; description = `Attempt ${build.attempt ?? 1} of ${build.maxAttempts ?? 3} was interrupted. The build will retry automatically.`; }
  if (build.status === 'FAILED' || build.status === 'CANCELLED') { percent = Math.min(percent, 99); title = build.status === 'FAILED' ? 'Build failed' : 'Build cancelled'; description = 'The build did not complete. You can start another build below.'; }
  const approval = build.configuration?.approval;
  if(build.phase==='partial' || build.coverage?.completeWithinScope===false){percent=Math.min(percent,99);title='Build incomplete';description='Some discovered sources or crawl limits need review. Any previous usable knowledge has been retained.';}
  if (build.status === 'SUCCESS' && approval) {
    percent = 100; title = 'Approved scope ready';
    description = `${approval.inventory.filter(entry => entry.disposition === 'required').length} required included sources processed. ${approval.inventory.filter(entry => entry.disposition === 'owner_excluded').length} optional pages explicitly excluded. Build work is complete within the approved scope; this is not whole-website coverage.`;
  }
  return { percent, title, description, step };
}

// The extension's background document. It runs exports, comparisons and sends while the side
// panel is closed or another tab is in front. It can only talk to the extension's own worker,
// which holds the editor tab, the lock and the downloads; it never reaches a page directly.
import {runJob, type EngineHost} from '../jobs/engine';
import {preparePreview, finishPreview, unauthorizedOrigins} from './preview-capture';
import {zipInWorker} from './zip-client';
import {validateContext, type Context} from '../core/model';
import type {Decision, JobRequest, JobState} from '../jobs/types';
type Running = {controller: AbortController; decide?: (decision: Decision) => void};
const jobs = new Map<string, Running>();
async function ask<T>(message: Record<string, unknown>): Promise<T> {
  const reply = await chrome.runtime.sendMessage(message) as {ok: boolean; value?: T; error?: string} | undefined;
  if (!reply) throw new Error('Sem resposta do editor. A extensão pode estar reiniciando.');
  if (!reply.ok) throw new Error(reply.error || 'Falha na comunicação com a extensão.');
  return reply.value as T;
}
function validDecision(value: unknown): Decision {
  const decision = value as Decision;
  if (decision?.action === 'partial' || decision?.action === 'discard') return {action: decision.action};
  if (decision?.action === 'allow' && Array.isArray(decision.origins) && decision.origins.length <= 32 && decision.origins.every(origin => typeof origin === 'string' && new URL(origin).origin === origin)) return {action: 'allow', origins: [...decision.origins]};
  throw new Error('Decisão inválida.');
}
function start(job: JobRequest, context: Context, token: string): void {
  if (jobs.has(job.id)) return;
  const controller = new AbortController(), running: Running = {controller};
  jobs.set(job.id, running);
  const base = {runner: job.id, session: token};
  // Reports leave in order, and the final state goes after all of them.
  let reports = Promise.resolve();
  const host: EngineHost = {
    rpc: request => ask({...base, ...request}),
    download: async (bytes, name, type = 'application/zip') => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], {type}));
      try {await ask({...base, action: 'job-download', url, name});} finally {URL.revokeObjectURL(url);}
    },
    report: (state: JobState) => {reports = reports.then(() => ask({...base, action: 'job-report', state})).then(() => {}, () => {});},
    wait: ms => ask({...base, action: 'job-wait', ms}),
    compress: zipInWorker,
    preview: {prepare: preparePreview, finish: finishPreview, unauthorized: unauthorizedOrigins}
  };
  const control = {signal: controller.signal, decision: () => new Promise<Decision>(resolve => {running.decide = resolve;})};
  void runJob(job, context, host, control)
    .then(async state => {await reports; await ask({...base, action: 'job-finish', state}).catch(() => {});})
    .finally(() => jobs.delete(job.id));
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // Only the extension's worker controls jobs: not a tab, not a page of the extension.
  if (message?.target !== 'runner' || sender.id !== chrome.runtime.id || sender.tab || sender.documentId !== undefined) return false;
  try {
    const running = typeof message.jobId === 'string' ? jobs.get(message.jobId) : undefined;
    if (message.action === 'start') start(message.job as JobRequest, validateContext(message.context), String(message.token));
    else if (message.action === 'cancel') {running?.controller.abort(); running?.decide?.({action: 'discard'});}
    else if (message.action === 'decide') {
      if (!running?.decide) throw new Error('Nada aguarda sua decisão nesta operação.');
      const decide = running.decide; running.decide = undefined; decide(validDecision(message.decision));
    } else if (message.action === 'has') {reply({ok: true, value: !!running}); return false;}
    else return false;
    reply({ok: true});
  } catch (error) {reply({ok: false, error: error instanceof Error ? error.message : String(error)});}
  return false;
});
document.documentElement.dataset.ready = 'true';

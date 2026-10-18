import type {RPC} from '../browser/adapter';
import type {Context} from '../core/model';
import {runJob, type EngineHost, type PreviewTools} from '../jobs/engine';
import type {Decision, JobRequest, JobState} from '../jobs/types';
// The panel never runs a long operation itself: it asks for one and watches its state. In the
// extension the state lives in the extension's session storage, so a panel opened later (after
// switching tabs, or closing and reopening it) sees exactly where the operation is.
export interface JobClient {
  start(request: JobRequest, context: Context): Promise<void>;
  cancel(): Promise<void>;
  decide(decision: Decision): Promise<void>;
  state(): Promise<JobState | undefined>;
  dismiss(): Promise<void>;
  subscribe(listener: (state: JobState | undefined) => void): void;
}
type Send = (message: Record<string, unknown>) => Promise<unknown>;
export class ExtensionJobs implements JobClient {
  constructor(private readonly tabId: number, private readonly send: Send) {}
  async start(request: JobRequest, context: Context): Promise<void> {await this.send({action: 'job-start', job: request, context});}
  async cancel(): Promise<void> {await this.send({action: 'job-cancel'});}
  async decide(decision: Decision): Promise<void> {await this.send({action: 'job-decide', decision});}
  // Asking the worker (not reading storage directly) also clears a job whose runner is gone.
  async state(): Promise<JobState | undefined> {return await this.send({action: 'job-state'}) as JobState | undefined;}
  async dismiss(): Promise<void> {await this.send({action: 'job-dismiss'});}
  subscribe(listener: (state: JobState | undefined) => void): void {
    const key = `job:${this.tabId}`;
    chrome.storage.session.onChanged.addListener(changes => {if (key in changes) listener(changes[key].newValue as JobState | undefined);});
  }
}
// The fictitious editor of the demo page runs the same engine inside the page.
export class LocalJobs implements JobClient {
  private current?: JobState;
  private controller?: AbortController;
  private decision?: (value: Decision) => void;
  private readonly listeners: ((state: JobState | undefined) => void)[] = [];
  constructor(private readonly rpc: RPC, private readonly tools: {download: EngineHost['download']; compress?: EngineHost['compress']; preview?: PreviewTools}) {}
  private emit(state: JobState): void {this.current = state; for (const listener of this.listeners) listener(state);}
  async start(request: JobRequest, context: Context): Promise<void> {
    if (this.current && (this.current.status === 'running' || this.current.status === 'waiting')) throw new Error('Uma operação já está em andamento.');
    const controller = this.controller = new AbortController();
    const host: EngineHost = {rpc: this.rpc, download: this.tools.download, report: state => this.emit(state), wait: ms => new Promise(resolve => setTimeout(resolve, ms)), ...(this.tools.compress ? {compress: this.tools.compress} : {}), ...(this.tools.preview ? {preview: this.tools.preview} : {})};
    void runJob(request, context, host, {signal: controller.signal, decision: () => new Promise(resolve => {this.decision = resolve;})}).then(state => this.emit(state));
  }
  async cancel(): Promise<void> {this.controller?.abort(); this.decision?.({action: 'discard'});}
  async decide(decision: Decision): Promise<void> {const resolve = this.decision; this.decision = undefined; resolve?.(decision);}
  async state(): Promise<JobState | undefined> {return this.current;}
  async dismiss(): Promise<void> {this.current = undefined;}
  subscribe(listener: (state: JobState | undefined) => void): void {this.listeners.push(listener);}
}

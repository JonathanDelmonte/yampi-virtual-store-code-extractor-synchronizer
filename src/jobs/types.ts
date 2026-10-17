import type {Context, Plan} from '../core/model';
import type {PhaseState} from '../core/progress';
// A long operation that runs outside the panel: in the extension's background document, so
// closing the panel or switching tabs never stops it. The panel only shows its state.
export type JobKind = 'export' | 'compare' | 'send';
export type JobStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type Scope = 'project' | 'restore';
export interface JobRequest {
  id: string; kind: JobKind;
  // export: also capture the published storefront (already authorized by the user in the panel).
  includePreview?: boolean;
  // compare and send: the project or the undo of an earlier send (journalId).
  scope?: Scope; journalId?: string;
  // compare: the store files to read; full reads every file.
  paths?: string[]; full?: boolean;
  // send: continue this interrupted send instead of starting one.
  resume?: string;
}
// The send itself (plan and choices) is written by the panel before the job starts: too large
// for a message, and kept so an interrupted send can continue exactly as it was confirmed.
export interface SendInput {plan: Plan; selected: string[]; scope: Scope; journalId?: string}
export interface JobEvent {at: number; text: string; path?: string; tone: 'ok' | 'info' | 'warn' | 'error'}
export interface Waiting {kind: 'origins'; origins: string[]}
export type Decision = {action: 'allow'; origins: string[]} | {action: 'partial'} | {action: 'discard'};
export type JobResult =
  | {kind: 'export'; texts: number; images: number; pages?: number; fileName: string; preview: string; previewDetails?: string}
  | {kind: 'compare'; read: number; listed: number; full: boolean}
  | {kind: 'send'; journalId?: string; verified: number; created: number; uploaded: number; total: number; warnings: string[]; preview?: string};
export interface JobState {
  id: string; kind: JobKind; status: JobStatus; scope?: Scope; resumed?: boolean;
  context: Context; title: string; detail: string; path?: string;
  phases: PhaseState[]; fraction: number; elapsedMs: number; etaMs?: number;
  startedAt: number; updatedAt: number; finishedAt?: number;
  events: JobEvent[]; error?: string; waiting?: Waiting; result?: JobResult;
}
export const active = (state?: JobState) => !!state && (state.status === 'running' || state.status === 'waiting');

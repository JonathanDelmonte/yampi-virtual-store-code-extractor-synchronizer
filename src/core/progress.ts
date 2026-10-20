// Weighted progress for long operations. Each phase counts items of similar cost; the weight
// says how long one item takes compared with reading a file, so the bar moves at an even pace
// even when a phase has few slow items (an image upload) and another many fast ones (reads).
export type PhaseStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';
export interface PhaseSpec {id: string; label: string; weight: number; total?: number}
export interface PhaseState {id: string; label: string; done: number; total: number; status: PhaseStatus}
export interface ProgressSnapshot {phases: PhaseState[]; fraction: number; elapsedMs: number; etaMs?: number}
type Phase = PhaseState & {weight: number};
const WINDOW_MS = 90_000;
export class ProgressTracker {
  private readonly phases: Phase[];
  private readonly started: number;
  // Completed work over time, for the estimate. Old samples leave the window, so a slow
  // start (the first reload of a cold editor) stops weighing on the estimate.
  private samples: {at: number; units: number}[] = [];
  // The bar never moves back. A phase may learn its size late (the store's file list, the
  // storefront's images), and the larger total would make the work done look smaller: the bar
  // then keeps its place, and the width still ahead stands for the work still ahead.
  private shown = 0;
  private shownUnits = 0;
  private anchor = {fraction: 0, units: 0, total: -1};
  constructor(specs: PhaseSpec[], private readonly now: () => number = Date.now) {
    this.phases = specs.map(spec => ({id: spec.id, label: spec.label, weight: spec.weight, done: 0, total: spec.total ?? 0, status: 'pending'}));
    this.started = now();
    this.samples.push({at: this.started, units: 0});
  }
  private phase(id: string): Phase {
    const phase = this.phases.find(p => p.id === id);
    if (!phase) throw new Error(`Etapa desconhecida: ${id}`);
    return phase;
  }
  private units(): number {return this.phases.reduce((sum, p) => sum + Math.min(p.done, p.total) * p.weight, 0);}
  private record(): void {
    const at = this.now();
    this.samples.push({at, units: this.units()});
    while (this.samples.length > 2 && at - this.samples[1].at > WINDOW_MS) this.samples.shift();
  }
  // A phase can learn its size only when it starts (the store's file list, a batch of uploads).
  total(id: string, total: number): void {
    const phase = this.phase(id);
    phase.total = Math.max(0, total);
    phase.done = Math.min(phase.done, phase.total);
  }
  // The wording can follow how the work is being done (straight from the server, or through the editor).
  relabel(id: string, label: string): void {this.phase(id).label = label;}
  status(id: string): PhaseStatus | undefined {return this.phases.find(p => p.id === id)?.status;}
  start(id: string, total?: number): void {
    const phase = this.phase(id);
    if (total !== undefined) this.total(id, total);
    for (const other of this.phases) if (other.status === 'active' && other !== phase) other.status = 'done';
    phase.status = 'active';
  }
  set(id: string, done: number): void {
    const phase = this.phase(id);
    if (phase.status === 'pending') this.start(id);
    phase.done = Math.max(0, Math.min(done, phase.total));
    this.record();
  }
  advance(id: string, count = 1): void {this.set(id, this.phase(id).done + count);}
  finish(id: string): void {const phase = this.phase(id); phase.done = phase.total; phase.status = phase.total ? 'done' : 'skipped'; this.record();}
  skip(id: string): void {const phase = this.phase(id); phase.total = 0; phase.done = 0; phase.status = 'skipped';}
  failActive(): void {for (const phase of this.phases) if (phase.status === 'active') phase.status = 'failed';}
  complete(): void {
    for (const phase of this.phases) if (phase.status !== 'failed') {phase.done = phase.total; phase.status = phase.total ? 'done' : 'skipped';}
    this.record();
  }
  snapshot(): ProgressSnapshot {
    const total = this.phases.reduce((sum, p) => sum + p.total * p.weight, 0), done = this.units();
    if (total !== this.anchor.total) this.anchor = {fraction: this.shown, units: Math.min(this.shownUnits, done), total};
    const ahead = total - this.anchor.units;
    const fraction = ahead > 0 ? this.anchor.fraction + (1 - this.anchor.fraction) * Math.max(0, done - this.anchor.units) / ahead : total && done >= total ? 1 : this.anchor.fraction;
    this.shown = Math.min(1, Math.max(this.shown, fraction)); this.shownUnits = done;
    // 100% means finished: while any step still has work ahead (or has not learned its size), the
    // bar stops just short of the end, whatever the estimate of the remaining work says.
    const open = this.phases.some(p => (p.status === 'pending' || p.status === 'active') && (p.total === 0 || p.done < p.total));
    if (open) this.shown = Math.min(this.shown, 0.99);
    return {
      phases: this.phases.map(({weight: _weight, ...state}) => state),
      fraction: this.shown,
      elapsedMs: this.now() - this.started,
      etaMs: this.estimate(total - done)
    };
  }
  // Rate over the recent window. No estimate until there is enough history to be honest about it.
  private estimate(remaining: number): number | undefined {
    if (remaining <= 0) return 0;
    const first = this.samples[0], last = this.samples.at(-1)!;
    const span = last.at - first.at, units = last.units - first.units;
    if (this.samples.length < 4 || span < 4000 || units <= 0) return undefined;
    return Math.round(remaining * span / units);
  }
}
// "3 min", "40 s", "1 h 05 min": short and stable, rounded so the number does not jitter.
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 50) return `${Math.max(5, Math.ceil(seconds / 5) * 5)}\u00a0s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}\u00a0min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `${hours}\u00a0h ${String(rest).padStart(2, '0')}\u00a0min`;
}

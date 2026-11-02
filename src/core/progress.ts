// Weighted progress for long operations. Each phase counts items of similar cost; the weight
// says roughly how many seconds one item takes, so the bar moves at an even pace even when a
// phase has few slow items (an image upload) and another many fast ones (reads).
export type PhaseStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';
// expect: how many items a phase usually has, while it does not know its size yet (the store's
// file list, the storefront's pages and images). Its share of the bar is kept for it from the
// start, so the steps before it never fill the bar.
export interface PhaseSpec {id: string; label: string; weight: number; total?: number; expect?: number}
export interface PhaseState {id: string; label: string; done: number; total: number; status: PhaseStatus}
export interface ProgressSnapshot {phases: PhaseState[]; fraction: number; elapsedMs: number; etaMs?: number}
type Phase = PhaseState & {weight: number; expect: number; known: boolean};
const WINDOW_MS = 90_000;
// The bar's end is the end of the work: never shown before every step finished.
const BEFORE_END = 0.99;
export class ProgressTracker {
  private readonly phases: Phase[];
  private readonly started: number;
  // Completed work over time, for the estimate. Old samples leave the window, so a slow
  // start (the first reload of a cold editor) stops weighing on the estimate.
  private samples: {at: number; units: number}[] = [];
  // The bar never moves back. When a phase learns its real size (or the pace of its items), the
  // work done would look bigger or smaller: the bar keeps its place, and the width still ahead
  // stands for the work still ahead.
  private shown = 0;
  private shownUnits = 0;
  private anchor = {fraction: 0, units: 0, total: -1};
  private finished = false;
  constructor(specs: PhaseSpec[], private readonly now: () => number = Date.now) {
    this.phases = specs.map(spec => ({id: spec.id, label: spec.label, weight: spec.weight, expect: Math.max(0, spec.expect ?? 0), known: spec.total !== undefined, done: 0, total: spec.total ?? 0, status: 'pending'}));
    this.started = now();
    this.samples.push({at: this.started, units: 0});
  }
  private phase(id: string): Phase {
    const phase = this.phases.find(p => p.id === id);
    if (!phase) throw new Error(`Etapa desconhecida: ${id}`);
    return phase;
  }
  // The size a phase stands for in the bar: its real size, or what it usually has until it knows.
  private planned(p: Phase): number {return p.status === 'skipped' ? 0 : p.known ? p.total : Math.max(p.expect, p.done);}
  private units(): number {return this.phases.reduce((sum, p) => sum + Math.min(p.done, this.planned(p)) * p.weight, 0);}
  private record(): void {
    const at = this.now();
    // A change of pace or size is not work done: the window starts again from here.
    const units = this.units(), last = this.samples.at(-1);
    if (last && units < last.units) this.samples = [];
    this.samples.push({at, units});
    while (this.samples.length > 2 && at - this.samples[1].at > WINDOW_MS) this.samples.shift();
  }
  // A phase can learn its size only when it starts (the store's file list, a batch of uploads).
  total(id: string, total: number): void {
    const phase = this.phase(id);
    phase.total = Math.max(0, total); phase.known = true;
    phase.done = Math.min(phase.done, phase.total);
  }
  // The wording can follow how the work is being done (straight from the server, or through the editor).
  relabel(id: string, label: string): void {this.phase(id).label = label;}
  // So can the time one item takes: a file read straight from the server costs a fraction of one
  // opened in the editor.
  reweight(id: string, weight: number): void {
    const phase = this.phase(id);
    if (phase.weight === weight) return;
    phase.weight = Math.max(0, weight);
    // The recent pace was measured with the old weight: the estimate starts again from here.
    this.samples = []; this.record();
  }
  // What a phase usually has can be known before its real size (the paths a comparison reads).
  expect(id: string, count: number): void {this.phase(id).expect = Math.max(0, count);}
  status(id: string): PhaseStatus | undefined {return this.phases.find(p => p.id === id)?.status;}
  start(id: string, total?: number): void {
    const phase = this.phase(id);
    if (total !== undefined) this.total(id, total);
    for (const other of this.phases) if (other.status === 'active' && other !== phase) this.close(other);
    phase.status = 'active';
  }
  // A step left behind by the next one is over: a size it never learned no longer holds a place.
  private close(phase: Phase): void {
    if (!phase.known) {phase.total = phase.done; phase.known = true;}
    phase.status = 'done';
  }
  set(id: string, done: number): void {
    const phase = this.phase(id);
    if (phase.status === 'pending') this.start(id);
    phase.done = Math.max(0, phase.known ? Math.min(done, phase.total) : done);
    this.record();
  }
  advance(id: string, count = 1): void {this.set(id, this.phase(id).done + count);}
  finish(id: string): void {
    const phase = this.phase(id);
    if (!phase.known) {phase.total = phase.done; phase.known = true;}
    phase.done = phase.total; phase.status = phase.total ? 'done' : 'skipped'; this.record();
  }
  skip(id: string): void {const phase = this.phase(id); phase.total = 0; phase.done = 0; phase.known = true; phase.status = 'skipped';}
  failActive(): void {for (const phase of this.phases) if (phase.status === 'active') phase.status = 'failed';}
  complete(): void {
    for (const phase of this.phases) if (phase.status !== 'failed') {
      if (!phase.known) {phase.total = phase.done; phase.known = true;}
      phase.done = phase.total; phase.status = phase.total ? 'done' : 'skipped';
    }
    this.finished = true;
    this.record();
  }
  snapshot(): ProgressSnapshot {
    const total = this.phases.reduce((sum, p) => sum + this.planned(p) * p.weight, 0), done = this.units();
    if (total !== this.anchor.total) this.anchor = {fraction: this.shown, units: Math.min(this.shownUnits, done), total};
    const ahead = total - this.anchor.units;
    const fraction = ahead > 0 ? this.anchor.fraction + (1 - this.anchor.fraction) * Math.max(0, done - this.anchor.units) / ahead : total && done >= total ? 1 : this.anchor.fraction;
    // 100% means finished: until the operation says so, the bar stops just short of the end.
    this.shown = Math.min(this.finished ? 1 : BEFORE_END, Math.max(this.shown, this.finished ? 1 : fraction)); this.shownUnits = done;
    return {
      phases: this.phases.map(({weight: _weight, expect: _expect, known: _known, ...state}) => state),
      fraction: this.shown,
      elapsedMs: this.now() - this.started,
      etaMs: this.finished ? 0 : this.estimate(total - done)
    };
  }
  // Rate over the recent window. No estimate until there is enough history to be honest about it.
  private estimate(remaining: number): number | undefined {
    if (remaining <= 0) return 0;
    const first = this.samples[0], last = this.samples.at(-1);
    if (!first || !last) return undefined;
    const span = last.at - first.at, units = last.units - first.units;
    if (this.samples.length < 4 || span < 4000 || units <= 0) return undefined;
    return Math.round(remaining * span / units);
  }
}
// "3 min", "40 s", "1 h 05 min": short and stable, rounded so the number does not jitter.
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const seconds = Math.round(ms / 1000);
  if (seconds < 50) return `${Math.max(5, Math.ceil(seconds / 5) * 5)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `${hours} h ${String(rest).padStart(2, '0')} min`;
}

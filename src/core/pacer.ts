// Public reads of the storefront, many in a row. When the store asks for calm (HTTP 429 or 503),
// every read waits together, not only the one that got the answer, and from then on they leave
// further apart (up to one every 2 s). Each read that succeeds shortens the gap again, a little.
export class Pacer {
  private pausedUntil = 0; private nextSlot = 0; private gap = 0;
  // Waiting is injected: the background runner asks the extension worker, because timers in a
  // hidden document can be delayed by the browser.
  constructor(private readonly wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), private readonly now: () => number = Date.now, private readonly signal?: AbortSignal) {}
  async sleep(ms: number): Promise<void> {
    // The worker waits at most 10 s per call.
    for (let left = ms; left > 0; left -= 10000) {if (this.signal?.aborted) throw new Error('Captura de prévia cancelada.'); await this.wait(Math.min(left, 10000));}
  }
  async turn(): Promise<void> {
    const now = this.now(), slot = Math.max(now, this.pausedUntil, this.nextSlot);
    this.nextSlot = slot + this.gap;
    if (slot > now) await this.sleep(slot - now);
  }
  calm(seconds: number): void {this.pausedUntil = Math.max(this.pausedUntil, this.now() + seconds * 1000); this.gap = Math.min(2000, this.gap + 250);}
  ok(): void {this.gap = Math.max(0, this.gap - 25);}
}
// Several reads at a time, results in the order of the items.
export async function pool<T, R>(items: T[], work: (item: T) => Promise<R>, parallel = 4): Promise<R[]> {
  const results: R[] = []; let next = 0;
  await Promise.all(Array.from({length: Math.min(parallel, items.length)}, async () => {while (next < items.length) {const index = next++; results[index] = await work(items[index]);}}));
  return results;
}

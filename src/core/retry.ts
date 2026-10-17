import type {Adapter} from './model';
// Failures that come from timing — the editor still loading after a reload, a slow or hidden tab,
// the extension worker restarting — and never from content. Conflicts, a changed store or a file
// that did not persist are not here: those stop the operation.
const TRANSIENT = [
  /dentro do prazo/i,
  /Sem resposta do editor/i,
  /ainda não está disponível/i,
  /Componente do editor Yampi não reconhecido/i,
  /O componente do editor mudou durante a operação/i,
  /executando outra operação/i,
  /não terminou de recarregar/i,
  /Frame with ID \d+ (?:was removed|is showing error page)/i,
  /No frame with id/i,
  /Cannot access contents of/i,
  /message port closed before a response/i,
  /Could not establish connection/i,
  /Receiving end does not exist/i
];
export function transient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT.some(pattern => pattern.test(message));
}
export interface RetryOptions {
  // Waiting is injected: the background runner asks the extension worker to wait, because
  // timers in a hidden document can be delayed by the browser.
  wait: (ms: number) => Promise<void>;
  attempts?: number;
  signal?: AbortSignal;
  onRetry?: (error: unknown, attempt: number) => void;
}
export async function retry<T>(job: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; ; attempt++) {
    try {return await job();} catch (error) {
      if (attempt >= attempts || options.signal?.aborted || !transient(error)) throw error;
      options.onRetry?.(error, attempt);
      await options.wait(attempt === 1 ? 800 : 2500);
    }
  }
}
// Reading and reloading can be repeated safely. Saving, creating and uploading never are:
// a failure there stops the send, and only the user can continue it.
export function retryReads(adapter: Adapter, options: RetryOptions): Adapter {
  return {
    context: () => retry(() => adapter.context(), options),
    inventory: () => retry(() => adapter.inventory(), options),
    read: path => retry(() => adapter.read(path), options),
    readAsset: adapter.readAsset && (path => retry(() => adapter.readAsset!(path), options)),
    refresh: () => retry(() => adapter.refresh(), options),
    write: (path, expected, content) => adapter.write(path, expected, content),
    create: adapter.create && (path => adapter.create!(path)),
    upload: adapter.upload && ((path, bytes) => adapter.upload!(path, bytes))
  };
}

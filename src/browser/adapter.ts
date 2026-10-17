import type {Adapter, Context} from '../core/model';
import type {Data} from '../core/preview';
import type {Command} from './bridge';
export type RPC = (request: {action?: string; access?: 'read' | 'write'; command?: Command; preview?: {url?: string; origins?: string[]; context: Context}}) => Promise<unknown>;
export class BrowserAdapter implements Adapter {
  private expected?: Context;
  constructor(readonly rpc: RPC) {}
  async context(): Promise<Context> {
    const context = await this.rpc({command: {op: 'context', context: this.expected}}) as Context;
    this.expected = context;
    return context;
  }
  async visual(): Promise<Data> {return await this.rpc({command:{op:'visual',context:this.expected}}) as Data;}
  async links(): Promise<{preview?: string}> {return await this.rpc({command: {op: 'links', context: this.expected}}) as {preview?: string};}
  async inventory(): Promise<string[]> {return await this.rpc({command: {op: 'inventory', context: this.expected}}) as string[];}
  async read(path: string): Promise<string> {return await this.rpc({command: {op: 'read', context: this.expected, path}}) as string;}
  async readAsset(path: string): Promise<Uint8Array> {
    const encoded = await this.rpc({command: {op: 'readAsset', context: this.expected, path}}) as string;
    return Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  }
  // The send reloads the editor after every change, so the file opened here is the server's
  // version; the bridge still compares it with the expected content right before saving.
  async write(path: string, expected: string, content: string): Promise<void> {
    await this.rpc({command: {op: 'write', context: this.expected, path, expected, content}});
  }
  async create(path: string): Promise<void> {await this.rpc({command: {op: 'create', context: this.expected, path}});}
  async upload(path: string, bytes: Uint8Array): Promise<void> {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    await this.rpc({command: {op: 'upload', context: this.expected, path, content: btoa(binary)}});
  }
  async refresh(): Promise<void> {
    await this.context(); // Refuse a reload when the editor has unsaved changes or changed shops.
    // The extension's worker reloads and waits until the editor answers again.
    await this.rpc({action: 'refresh'});
    const start = Date.now();
    for (;;) {
      try {await this.context(); return;} catch (e) {
        if (Date.now() - start > 25000) throw e;
        await new Promise(r => setTimeout(r, 250));
      }
    }
  }
}

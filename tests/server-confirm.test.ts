import {describe, test, expect} from 'vitest';
import {makePlan} from '../src/core/planner';
import {applyPlan, capture} from '../src/core/workflow';
import type {Assets, DirectReader, Files} from '../src/core/model';
import {FakeEditor, png, recorder, snapshot} from './fixtures/fake-editor';
// An editor whose server is separate from what its page shows: a save the server rejects stays
// only on the page, and someone else's save reaches only the server.
class ServerEditor extends FakeEditor {
  server: Files; serverAssets: Assets; rejectSave?: string; serverReads = 0;
  constructor(files: Files, assets: Assets = {}) {super(files, assets); this.server = {...files}; this.serverAssets = {...assets};}
  direct: DirectReader = {
    open: async () => 'loja-ficticia',
    read: async (paths, store) => {
      if (store !== 'loja-ficticia') throw new Error('loja errada');
      this.serverReads++;
      const files: Files = {}, assets: Assets = {};
      for (const path of paths) {if (path in this.server) files[path] = this.server[path]; else if (path in this.serverAssets) assets[path] = this.serverAssets[path]; else throw new Error(`O servidor da Yampi recusou a leitura (HTTP 404).`);}
      return {files, assets, rest: []};
    }
  };
  async write(path: string, expected: string, content: string) {await super.write(path, expected, content); if (path !== this.rejectSave) this.server[path] = content;}
  async create(path: string) {await super.create(path); this.server[path] = this.files[path];}
  async upload(path: string, bytes: Uint8Array) {await super.upload(path, bytes); this.serverAssets[path] = new Uint8Array(bytes);}
}
const home = 'templates/home.twig', head = 'elements/head.twig', store = {[home]: 'home', [head]: 'head'};
const plan = (editor: FakeEditor, local: Files, assets: Assets = {}, uploads = true) => makePlan(snapshot(store), local, snapshot(editor.files, editor.assets), assets, {uploads});
describe('envio conferido no servidor da Yampi, sem recarregar o editor', () => {
  test('salva, cria, envia imagem e confere tudo no servidor: nenhuma recarga', async () => {
    const editor = new ServerEditor(store), rec = recorder();
    const local = {...store, [home]: 'novo home', 'templates/nova.twig': 'nova'};
    const journal = await applyPlan(editor, plan(editor, local, {'assets/images/a.png': png(1)}), [home, 'templates/nova.twig', 'assets/images/a.png'], rec);
    expect(journal.status).toBe('completed');
    expect(editor.refreshes).toBe(0);
    expect(editor.server[home]).toBe('novo home');
    expect(editor.server['templates/nova.twig']).toBe('nova');
    expect(editor.serverAssets['assets/images/a.png']).toEqual(png(1));
    expect(editor.serverReads).toBeGreaterThan(0);
  });
  test('o servidor não ficou com o que a página mostra: para no arquivo, com o registro', async () => {
    const editor = new ServerEditor(store), rec = recorder();
    editor.rejectSave = home;
    await expect(applyPlan(editor, plan(editor, {...store, [home]: 'novo home'}), [home], rec)).rejects.toThrow(`não persistiu na Yampi: ${home}`);
    expect(rec.last()).toMatchObject({status: 'stopped', verified: [], pending: home});
    expect(editor.refreshes).toBe(0);
  });
  test('mudança feita por outra pessoa só no servidor para o envio antes de gravar', async () => {
    const editor = new ServerEditor(store), rec = recorder();
    const sending = plan(editor, {...store, [home]: 'novo home'});
    editor.server[home] = 'home de outra pessoa';
    await expect(applyPlan(editor, sending, [home], rec)).rejects.toThrow(`Conflito após a comparação: ${home}`);
    expect(editor.writes).toEqual([]);
  });
  test('sem o servidor, o editor é recarregado como antes', async () => {
    const editor = new FakeEditor(store), rec = recorder();
    await applyPlan(editor, plan(editor, {...store, [home]: 'novo home'}), [home], rec);
    expect(editor.refreshes).toBeGreaterThan(0);
  });
  test('servidor de outra loja interrompe sem gravar', async () => {
    const editor = new ServerEditor(store), rec = recorder();
    editor.direct.open = async () => {throw new Error('A sessão da Yampi passou para outra loja, diferente da que o editor mostra.');};
    await expect(applyPlan(editor, plan(editor, {...store, [home]: 'novo home'}), [home], rec)).rejects.toThrow('passou para outra loja');
    expect(editor.writes).toEqual([]);
  });
  test('comparação sem recarregar: lê o servidor mesmo com poucos arquivos, nunca o texto antigo da aba', async () => {
    const editor = new ServerEditor(store);
    editor.server[home] = 'home salvo por outra pessoa';
    const reading = await capture(editor, {only: [home], serverOnly: true});
    expect(reading.files[home]).toBe('home salvo por outra pessoa');
    expect(editor.reads).toEqual([]);
    const broken = new ServerEditor(store);
    broken.direct.read = async () => {throw new Error('O servidor da Yampi não respondeu.');};
    await expect(capture(broken, {only: [home], serverOnly: true})).rejects.toThrow('Nada foi alterado');
  });
});

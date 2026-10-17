import {describe, test, expect} from 'vitest';
import {folderEntries, replaceThemeFile, type Folder} from '../src/panel/folder';
// An in-memory directory, shaped like the File System Access handles the panel receives.
class FakeFile {
  readonly kind = 'file';
  constructor(readonly name: string, public bytes: Uint8Array) {}
  async getFile() {const bytes = this.bytes; return {size: bytes.length, arrayBuffer: async () => bytes.slice().buffer};}
  async createWritable() {
    let data = '';
    return {write: async (text: string) => {data += text;}, close: async () => {this.bytes = new TextEncoder().encode(data);}};
  }
}
class FakeDir {
  readonly kind = 'directory';
  readonly entries = new Map<string, FakeDir | FakeFile>();
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string) {const found = this.entries.get(name); if (found instanceof FakeDir) return found; throw new DOMException('Ausente', 'NotFoundError');}
  async getFileHandle(name: string) {const found = this.entries.get(name); if (found instanceof FakeFile) return found; throw new DOMException('Ausente', 'NotFoundError');}
  async *values() {yield* this.entries.values();}
}
function tree(name: string, files: Record<string, string | Uint8Array>): FakeDir {
  const root = new FakeDir(name);
  for (const [path, value] of Object.entries(files)) {
    const parts = path.split('/'), file = parts.pop()!;
    let dir = root;
    for (const part of parts) {if (!dir.entries.has(part)) dir.entries.set(part, new FakeDir(part)); dir = dir.entries.get(part) as FakeDir;}
    dir.entries.set(file, new FakeFile(file, typeof value === 'string' ? new TextEncoder().encode(value) : value));
  }
  return root;
}
const folder = (dir: FakeDir) => dir as unknown as Folder;
const read = (root: FakeDir, path: string) => {
  let node: FakeDir | FakeFile | undefined = root;
  for (const part of path.split('/')) node = (node as FakeDir).entries.get(part);
  return (node as FakeFile).bytes;
};
const hero = 'sections/hero.twig';
const project = (content: string | Uint8Array) => ({'.yampi-sync/manifest.json': '{}', [`tema/${hero}`]: content, 'tema/templates/home.twig': 'home', 'node_modules/x/index.js': 'ignorado'});
describe('trazer a versão da loja para a pasta do projeto', () => {
  test('troca o arquivo e mantém as quebras de linha do projeto', async () => {
    const root = tree('loja', project('a\r\nb\r\n'));
    await replaceThemeFile(folder(root), hero, 'a\nb\n', 'loja\nnova\n');
    expect(new TextDecoder().decode(read(root, `tema/${hero}`))).toBe('loja\r\nnova\r\n');
  });
  test('mantém a marca de ordem de bytes', async () => {
    const root = tree('loja', project('﻿a\n'));
    await replaceThemeFile(folder(root), hero, 'a\n', 'loja\n');
    const bytes = read(root, `tema/${hero}`);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe('loja\n');
  });
  test('arquivo alterado no projeto depois da comparação não é sobrescrito', async () => {
    const root = tree('loja', project('editado à mão\n'));
    await expect(replaceThemeFile(folder(root), hero, 'a\n', 'loja\n')).rejects.toThrow('mudou no projeto');
    expect(new TextDecoder().decode(read(root, `tema/${hero}`))).toBe('editado à mão\n');
  });
  test('arquivo ausente não é criado', async () => {
    const root = tree('loja', project('a\n'));
    await expect(replaceThemeFile(folder(root), 'sections/novo.twig', '', 'loja\n')).rejects.toThrow('não está mais no projeto');
    expect([...(await (root.entries.get('tema') as FakeDir).getDirectoryHandle('sections')).entries.keys()]).toEqual(['hero.twig']);
  });
  test('caminho que sai do tema é recusado', async () => {
    const root = tree('loja', project('a\n'));
    await expect(replaceThemeFile(folder(root), '../.yampi-sync/manifest.json', '{}', 'x')).rejects.toThrow('Caminho inválido');
  });
  test('pasta acima do projeto: escreve no único projeto dentro dela', async () => {
    const parent = tree('trabalho', Object.fromEntries(Object.entries(project('a\n')).map(([path, value]) => [`loja/${path}`, value])));
    await replaceThemeFile(folder(parent), hero, 'a\n', 'loja\n');
    expect(new TextDecoder().decode(read(parent, `loja/tema/${hero}`))).toBe('loja\n');
  });
});
describe('leitura da pasta do projeto', () => {
  test('raiz do projeto: só tema/ e .yampi-sync/', async () => {
    const {name, entries} = await folderEntries(folder(tree('loja', project('a\n'))));
    expect(name).toBe('loja');
    expect(entries.map(entry => entry.path).sort()).toEqual(['.yampi-sync/manifest.json', `tema/${hero}`, 'tema/templates/home.twig']);
  });
  test('pasta acima do projeto e tema solto', async () => {
    const parent = tree('trabalho', Object.fromEntries(Object.entries(project('a\n')).map(([path, value]) => [`loja/${path}`, value])));
    expect((await folderEntries(folder(parent))).name).toBe('loja');
    const theme = await folderEntries(folder(tree('tema', {[hero]: 'a\n'})));
    expect(theme.entries.map(entry => entry.path)).toEqual([hero]);
  });
});

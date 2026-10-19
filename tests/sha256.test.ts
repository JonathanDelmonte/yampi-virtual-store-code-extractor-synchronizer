import {describe, test, expect} from 'vitest';
import {createHash} from 'node:crypto';
import {sha256Hex, textHash} from '../src/core/sha256';
describe('SHA-256 síncrono', () => {
  test('igual ao do Node em tamanhos de borda e textos com acentos', () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70000]) {
      const bytes = Uint8Array.from({length: size}, (_, i) => (i * 131 + size) & 255);
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(textHash('Coleção de verão\r\n')).toBe(createHash('sha256').update('Coleção de verão\n').digest('hex'));
  });
});

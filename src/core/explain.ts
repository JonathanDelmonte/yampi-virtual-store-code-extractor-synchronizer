import type {Plan, PlanRow} from './model';
import {IMAGES_OFF} from './planner';
const join = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items.at(-1)}` : items[0] ?? '';
// Why a changed file that uses others cannot be sent, in the user's terms, and which of the files
// it uses explain it: changed only in the store (bring that change to the project), in both
// (decide that file first) or a new image left out of the send. Anything else keeps the generic wording.
export interface Block {text: string; storeOnly: string[]; conflicts: string[]; images: string[]}
export function explainBlock(plan: Plan, row: PlanRow): Block | undefined {
  if (row.status !== 'blocked-dependency' || !row.blockedBy?.length) return undefined;
  const rows = new Map(plan.rows.map(item => [item.path, item]));
  const storeOnly = row.blockedBy.filter(path => rows.get(path)?.status === 'remote-only');
  const conflicts = row.blockedBy.filter(path => rows.get(path)?.status === 'conflict');
  const images = row.blockedBy.filter(path => rows.get(path)?.reason === IMAGES_OFF);
  const others = row.blockedBy.filter(path => !storeOnly.includes(path) && !conflicts.includes(path) && !images.includes(path));
  const one = (items: string[], single: string, many: string) => `${join(items)}, que ${items.length === 1 ? single : many}`;
  const clauses = [
    storeOnly.length ? one(storeOnly, 'mudou na loja depois da sua cópia', 'mudaram na loja depois da sua cópia') : '',
    conflicts.length ? one(conflicts, 'mudou na loja e no projeto', 'mudaram na loja e no projeto') : '',
    images.length ? one(images, 'é imagem nova e fica fora do envio enquanto “Enviar imagens novas” estiver desligado', 'são imagens novas e ficam fora do envio enquanto “Enviar imagens novas” estiver desligado') : '',
    others.length ? one(others, 'não pode ser enviado', 'não podem ser enviados') : ''
  ].filter(Boolean);
  return {text: `${row.source || row.path} usa ${clauses.join('; ')}.`, storeOnly, conflicts, images};
}

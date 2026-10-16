import type {PreviewBundle} from './preview';
import {emptyOverrides, pageSections, resolveSectionFile} from '../../local-runtime/contract.mjs';
import previewRuntime from '../../local-runtime/preview.mjs?raw';
import integrityRuntime from '../../local-runtime/integrity.mjs?raw';
import contractRuntime from '../../local-runtime/contract.mjs?raw';
import dependenciesRuntime from '../../local-runtime/dependencies.mjs?raw';
import parityRuntime from '../../local-runtime/parity.mjs?raw';
import engine from '../../local-runtime/engine.mjs?raw';
import dev from '../../local-runtime/dev.mjs?raw';
import pack from '../../local-runtime/pack.mjs?raw';
import platform from '../../local-runtime/platform.mjs?raw';
import browserPlatform from '../../local-runtime/platform-browser.mjs?raw';
import twig from '../../local-runtime/twig.mjs?raw';
import pkg from '../../local-runtime/package.json?raw';
import lock from '../../local-runtime/package-lock.json?raw';
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export const TOOL_FILES: Record<string, string> = {'engine.mjs': engine, 'dev.mjs': dev, 'pack.mjs': pack, 'platform.mjs': platform, 'platform-browser.mjs': browserPlatform, 'twig.mjs': twig, 'preview.mjs': previewRuntime, 'integrity.mjs': integrityRuntime, 'contract.mjs': contractRuntime, 'dependencies.mjs': dependenciesRuntime, 'parity.mjs': parityRuntime};
// Sections map generated from the exported inventory and the captured aliases.
// Rule-based resolution still applies; this file documents and allows overrides.
function sectionMap(paths: string[], preview?: PreviewBundle): Record<string, string> {
  const output: Record<string, string> = {};
  for (const page of preview?.pages || []) for (const section of pageSections(page.raw).main) {
    const alias = String(section.section_alias || '');
    try {output[`${page.kind}/${alias}`] ??= resolveSectionFile(alias, page.kind, paths);} catch {/* Reported in preview/report.json > contract. */}
  }
  return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
}
const GITIGNORE = `# Dependências e caches locais (reinstale com npm ci).
node_modules/
.cache/
# ZIPs de retorno gerados por npm run pack e seus hashes.
*.zip
*.zip.sha256
# Variáveis de ambiente nunca devem ser versionadas.
*.env
.env*
# Conteúdo da loja: ignorado por padrão para evitar publicação acidental.
# Em um repositório PRIVADO, remova estas linhas para versionar o tema (veja o README).
tema/
.yampi-sync/baseline/
.yampi-sync/manifest.json
preview/
# Sobreposições locais da prévia; podem conter dados da loja.
local.data.json
# Cópias de segurança do atualizador de ferramentas.
.yampi-sync/updates/
`;
const EDITORCONFIG = `# Preserva os arquivos exatamente como vieram do editor da Yampi.
root = true

[*]
end_of_line = lf
trim_trailing_whitespace = false
# insert_final_newline fica indefinido: "false" removeria a quebra final existente.
`;
const PRESERVE = {'editor.formatOnSave': false, 'editor.formatOnPaste': false, 'editor.formatOnType': false};
function readme(storeName: string, slug: string): string {
  return `# ${storeName.replace(/[\r\n]/g, ' ')} — projeto local

Abra esta pasta no VS Code, ou dê dois cliques em \`${slug}.code-workspace\`. O código da loja está em **tema/**. Os dados e recursos visuais ficam em **preview/** e não são enviados à Yampi.

## Iniciar

Com Node.js 24 instalado, abra o terminal nesta pasta:

\`\`\`sh
npm ci
npm run check:integrity
npm run check
npm run dev
\`\`\`

Abra http://127.0.0.1:5182: as páginas capturadas abrem pelos mesmos caminhos da loja (por exemplo, \`/\` e \`/produto-x\`). O índice em http://127.0.0.1:5182/__local/ lista as capturas e os templates sem captura. Edite \`tema/\` e recarregue para conferir.

\`npm run check\` compila todas as páginas, confere se cada seção visível foi renderizada e compara o CSS compilado com o CSS publicado capturado. O resultado fica em \`.cache/yampi-check.json\`. A falta de uma seção, um alias sem arquivo ou um dado obrigatório ausente interrompe o check com o nome da página, do alias ou do arquivo.

## Devolver as alterações

Execute \`npm run pack\` e importe o ZIP indicado no terminal em **Enviar alterações** na extensão. Também pode selecionar esta pasta inteira. Confira a comparação e confirme o envio. A publicação continua manual na Yampi.

\`npm run check:integrity -- --original\` confirma que o tema ainda é igual à exportação. \`npm run check:integrity -- --return-zip retorno-yampi.zip\` confere se o ZIP contém exatamente manifesto, originais e \`tema/\`, com os mesmos hashes.

## Limitações do retorno

- A extensão cria os textos novos (.twig, .vue, .scss) em pastas que já existem na loja e envia as imagens novas, sempre pelo próprio editor da Yampi. A Yampi não permite criar pastas: um texto numa pasta nova bloqueia o envio até ser movido. Imagens ficam direto em \`assets/images\`; as de subpastas vão para lá e as referências literais nos arquivos enviados são ajustadas.
- Um arquivo modificado que inclui, importa ou usa um caminho que não existirá na loja (Sass, Twig, componente Vue ou imagem) fica bloqueado, com o nome dos dois. Arquivos alterados que dependem uns dos outros são enviados juntos, inclusive os novos. Cada arquivo é conferido após recarregar o editor antes do próximo envio.
- \`elements/scripts/components.twig\` é gerado pela Yampi, que lista cada componente criado pela extensão; ele nunca é enviado. Na prévia local, um \`.vue\` fora dessa lista não é carregado; a prévia avisa e não o registra (use \`"components": {"registerUnlisted": true}\` em \`local.config.json\` apenas para testes locais).
- \`assets_url\` e \`asset()\` apontam para \`tema/assets/\` na prévia. O caminho de produção não foi verificado.
- Alterações só de espaço em branco aparecem separadas na comparação e podem ser descartadas.

## Como editar local.data.json

Este arquivo contém somente sobreposições, começando vazio. Os dados capturados em \`preview/raw/\` não mudam. Exemplo:

\`\`\`json
{
  "format": "yampi-local-overrides",
  "version": 1,
  "global": {"theme": {"params": {"color_primary": "#c0392b"}}},
  "pages": {
    "home": {"sections": {"main_banner": {"params": {"slider_delay": 8}}}},
    "page-3": {"data": {"content": {"data": {"name": "Outro título"}}}}
  }
}
\`\`\`

- \`global\` vale para todas as páginas; \`pages.home\` vale para todas as capturas da home; \`pages.page-3\` só para essa captura.
- Dentro de cada escopo: \`theme\` (parâmetros do tema), \`sections\` (por \`section_alias\` ou \`alias@ordem\`), \`merchant\` e \`data\`.
- A mesclagem segue o JSON Merge Patch (RFC 7396): objetos são mesclados, listas e valores substituídos, e \`null\` remove a chave.

## Atualizar as ferramentas de um projeto antigo

No repositório da extensão, faça uma nova exportação em outra pasta e execute:

\`\`\`sh
node scripts/update-project.mjs "caminho/deste/projeto" --preview "caminho/da/nova-exportacao.zip"
node scripts/update-project.mjs "caminho/deste/projeto" --preview "caminho/da/nova-exportacao.zip" --apply
\`\`\`

O primeiro comando mostra o que muda; o segundo aplica. Somente \`.yampi-sync/tools/\`, \`package.json\`, \`package-lock.json\` e \`preview/\` são substituídos. \`tema/\`, originais, manifesto e suas sobreposições são preservados. A cópia anterior fica em \`.yampi-sync/updates/\` e \`--rollback <pasta>\` desfaz a atualização.

## Versionar em um repositório privado

O \`.gitignore\` ignora \`tema/\`, originais, manifesto e \`preview/\` para evitar publicação acidental. Num repositório **privado**, remova essas linhas para versionar o tema. \`.gitattributes\` marca \`tema/\` e os originais como binários, preservando os bytes. Nunca versione credenciais, ZIPs de retorno ou dados de clientes.

## O que há nesta pasta

- **tema/**: arquivos editáveis copiados do editor da loja.
- **local.config.json**: páginas, entradas Sass, mapa de seções gerado a partir das capturas e opções de componentes.
- **local.data.json**: suas sobreposições da prévia.
- **preview/**: captura bruta imutável (\`raw/\`), leituras públicas gravadas, recursos, manifesto e relatório.
- **.yampi-sync/**: arquivos da extensão, recolhidos no VS Code. Guarda originais, manifesto com hashes e ferramentas locais. Preserve essa pasta: ela permite comparar as alterações e preparar o retorno com segurança.
- **.editorconfig** e **.vscode/settings.json**: preservam quebras de linha e espaços, para que abrir e salvar sem editar não gere diferença.

## Limites da prévia

O relatório em preview/report.json informa a origem, as chaves que o código usa e a captura não trouxe, aliases sem arquivo e recursos ausentes. Configuração publicada pode diferir do rascunho; compilação não certifica fidelidade visual.

A prévia compila Twig, Vue 2 e Sass e simula um conjunto explícito de helpers, mixins e leituras públicas gravadas. Rotas da API que não foram gravadas falham com erro explícito. Produtos e categorias são uma amostra datada; não há backend, estoque/preços em tempo real, pagamentos ou checkout. Chamadas externas e formulários são bloqueados. A barra inferior mostra seções renderizadas, imagens em placeholder, fontes com erro e rotas não capturadas. Confira também o resultado na Yampi antes de publicar. Vue 2 é mantido para compatibilidade e está fora de manutenção.

Imagens exportadas ficam em \`tema/assets/\`. Não altere \`.yampi-sync/manifest.json\` ou \`.yampi-sync/baseline/\`.

O projeto pode conter conteúdo privado da loja. Guarde-o fora do repositório público da extensão. O ZIP de retorno inclui somente o código editado e sua origem.
`;
}
export function localKit(paths: string[], storeName = 'Loja local', preview?: PreviewBundle): Record<string, string> {
  const normalized = storeName.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'loja-local';
  const slug = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(normalized) ? 'loja-' + normalized : normalized;
  const projectPackage = JSON.parse(pkg), projectLock = JSON.parse(lock);
  projectPackage.name = slug; projectLock.name = slug; projectLock.packages[''].name = slug;
  const templates = paths.filter(p => p.startsWith('templates/') && p.endsWith('.twig'));
  const globalStyles = ['assets/styles/global/main.scss', 'assets/styles/global/main.css'].filter(p => paths.includes(p));
  const styles = globalStyles.length ? globalStyles : paths.filter(p => /^assets\/styles\/global\/[^/]+\.(s?css)$/.test(p) && !p.split('/').at(-1)!.startsWith('_') && !/-mobile\.s?css$/.test(p));
  const mobileStyles = paths.filter(p => /^assets\/styles\/global\/main-mobile\.(s?css)$/.test(p));
  const pageStyles = Object.fromEntries(templates.map(p => {const page = p.slice(10, -5); return [page, paths.filter(file => file === `assets/styles/pages/${page}.scss`)];}));
  const mobilePageStyles = Object.fromEntries(templates.map(p => {const page = p.slice(10, -5); return [page, paths.filter(file => file === `assets/styles/pages/mobile/${page}.scss`)];}));
  const config = {port: 5182, pages: Object.fromEntries(templates.map(p => [p.slice(10, -5), p])), styles, mobileStyles, pageStyles, mobilePageStyles, sections: sectionMap(paths, preview), components: {registerUnlisted: false}, splideCss: false};
  return {
    'package.json': json(projectPackage), 'package-lock.json': json(projectLock),
    ...Object.fromEntries(Object.entries(TOOL_FILES).map(([name, source]) => ['.yampi-sync/tools/' + name, source])),
    'local.config.json': json(config),
    'local.data.json': json({$comment: 'Somente sobreposições da prévia; veja "Como editar local.data.json" no README.', ...emptyOverrides()}),
    '.gitignore': GITIGNORE,
    '.gitattributes': '* text eol=lf\ntema/** -text\n.yampi-sync/baseline/** -text\npreview/** -text\n',
    '.editorconfig': EDITORCONFIG,
    '.vscode/settings.json': json({'files.exclude': {'.yampi-sync': true, node_modules: true, '.cache': true}, 'search.exclude': {'.yampi-sync': true, node_modules: true, '.cache': true, preview: true}, 'files.eol': '\n', 'files.encoding': 'utf8', 'files.insertFinalNewline': false, 'files.trimFinalNewlines': false, 'files.trimTrailingWhitespace': false, ...PRESERVE, 'editor.codeActionsOnSave': {'source.fixAll': 'never', 'source.organizeImports': 'never'}, ...Object.fromEntries(['[twig]', '[vue]', '[scss]', '[css]', '[html]', '[javascript]', '[json]'].map(language => [language, PRESERVE]))}),
    [`${slug}.code-workspace`]: json({folders: [{path: '.', name: storeName}], settings: {}}),
    'README.md': readme(storeName, slug),
  };
}

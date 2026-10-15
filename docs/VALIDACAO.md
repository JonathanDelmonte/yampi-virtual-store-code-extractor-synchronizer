# Validação

## Nome aprovado e distribuição na 0.3.6

Execução em 15/10/2026, Windows, Node.js 24.19.0. O nome aprovado é **Zirtuno Sync Yampi**, e o repositório/pacote usa **zirtuno-sync-yampi**. `npm run package` passou, incluindo TypeScript, 145 testes em dez arquivos e build. O ZIP `zirtuno-sync-yampi-0.3.6.zip` contém 17 arquivos permitidos e teve seu SHA-256 conferido.

O pacote foi carregado em Chromium temporário e informou o nome aprovado, versão **0.3.6** e a página `https://github.com/ZIRTUNO/zirtuno-sync-yampi`. O painel fictício e a orientação foram conferidos em 280, 360 e 800 pixels, sem transbordamento, sobreposição entre nome e versão ou erros JavaScript; as capturas foram inspecionadas visualmente. Permissões, CSP, formatos de exportação e identificadores de armazenamento permanecem iguais. Nenhuma loja real foi acessada ou alterada.

## Identidade e distribuição na 0.3.5

Execução em 15/10/2026, Windows, Node.js 24.19.0. `npm ci` e `npm run package` passaram; este último executou `npm run check`, com TypeScript, 145 testes em dez arquivos e build da extensão. O ZIP `zirtuno-sync-0.3.5.zip` contém 17 arquivos permitidos, e seu SHA-256 foi conferido.

O pacote foi carregado em um perfil Chromium temporário: o manifesto instalado informa **Zirtuno Sync**, versão **0.3.5** e a página `https://github.com/ZIRTUNO/zirtuno-sync`. Permissões, CSP e demais capacidades do manifesto permanecem iguais às da versão anterior. O painel de demonstração fictícia e a orientação da extensão foram conferidos em 280, 360 e 800 pixels, sem transbordamento horizontal, sobreposição entre nome e versão ou erros JavaScript. As capturas foram inspecionadas visualmente. Formatos de exportação, identificadores internos e chaves de armazenamento não foram renomeados. Nenhuma loja real foi acessada ou alterada; os resultados históricos abaixo mantêm seu escopo original.

## Histórico da versão 0.3.4

Execução em 09/10/2026, Windows, Node.js 24.15.0. Fixtures, imagens e fonte usadas nos testes são inteiramente fictícias. Nenhuma escrita real na Yampi foi realizada.

## Desempenho e integridade na 0.3.4

`npm run check` passou com 145 testes em dez arquivos. Os seis casos novos verificam concorrência limitada a quatro recursos públicos, ordem e orçamento determinísticos, reaproveitamento somente na mesma exportação e com autorização, nova tentativa após falha, cancelamento sem requisições pendentes e ZIP com imagens intactas. A integração do adaptador verifica uma chamada por comando já conectado e reinjeção após reload.

`npm run test:e2e` e `npm run test:preview` foram repetidos nesta versão e passaram nos cenários fictícios descritos abaixo. A exportação pelo painel lateral nativo executou o worker de compactação distribuído. Importação, baseline, backup, envio fictício, reload, restauração protegida e prévia portátil continuaram funcionando. Durante a cópia, os contadores registraram zero edições, salvamentos, exclusões, criações, renomeações ou publicações. Nenhuma requisição alcançou uma loja real.

`npm run test:compression` passou com worker real em Chromium temporário: 5.575.444 bytes de entrada, conteúdo do ZIP igual às entradas originais, buffers preservados, cancelamento sem erro não tratado e workers encerrados. O timer do painel avançou 11 vezes durante a compactação, confirmando que ela saiu da thread da interface. O worker tem custo de inicialização; o teste não presume menor tempo total para qualquer tamanho de pacote.

A auditoria comparou o código da 0.3.3 e a 0.3.4 com as mesmas fixtures e três amostras por etapa. A mediana da preparação do ZIP caiu de 277,78 para 128,73 ms; a captura de 24 recursos com latência simulada de 25 ms caiu de 611,29 para 156,14 ms. Os 250 textos e quatro PNGs foram conferidos byte a byte após reimportação. São medições sintéticas de etapas, sem estimativa da duração total em uma loja real. [Método e comandos](AUDITORIA.md).

O pacote agora permite 17 arquivos, incluindo `zip-worker.js`. O instalador passa de 1.056.798 para 145.130 bytes (86% menor). A assinatura passa de 1.158.905 para 2.174 bytes, com o original preservado no código de desenvolvimento. Permissões e CSP permanecem iguais. Evidências locais atuais: `.cache/performance/baseline/report.json`, `.cache/performance/optimized/report.json`, `.cache/performance/worker/report.json` e `.cache/visual-validation/report.json`.

## Identidade e distribuição na 0.3.3

`npm ci`, `npm run check` e `npm run test:e2e` passaram: 139 testes em nove arquivos, seguidos do fluxo completo no painel lateral nativo de Chromium com editor fictício. A exportação continua exigindo confirmação e realizou zero edições, salvamentos ou acionamentos destrutivos. Importação, backup, envio fictício, reload, restauração protegida e captura visual fictícia também passaram. Nenhuma requisição alcançou uma loja real.

O cartão nativo de `chrome://extensions` foi conferido em perfil Chromium temporário: nome **Yampi Code Sync**, versão 0.3.3, autoria **Zirtuno**, descrição curta e nova logo. O Chrome reserva a área da descrição e controla o espaço até o ID; a extensão não injeta estilos nessa página. Painéis de 280 e 360 pixels preservaram os textos e o link Zirtuno, sem transbordamento horizontal ou erros JavaScript. O relatório histórico permanece em `.cache/brand-033/report.json`; suas três capturas antigas foram removidas na limpeza da 0.3.4.

O pacote tem os mesmos 16 arquivos permitidos. As cinco dimensões de ícones são geradas a partir dos bytes da logo autorizada, com proporções e transparência preservadas; a imagem original e Sharp ficam somente no código de desenvolvimento. A geração usa `.cache/package/`, sem acumular ZIPs no diretório de instalações. O campo de autoria do manifesto não configura nem publica a conta da Chrome Web Store.

## Interface na 0.3.2

`npm ci`, `npm run check` e `npm run package` passaram com Node 24.15.0 e 139 testes em nove arquivos. O fluxo foi repetido no painel lateral nativo de Chromium, com orientação fora do editor, navegação explícita na mesma aba, confirmação antes da cópia, exportação sem mutações, importação de pasta/ZIP, envio fictício com backup/reload, bloqueio de conflito na restauração e reconexão. Novos casos verificam que a orientação não autoriza comandos do editor e que um fechamento atrasado não desativa o painel seguinte.

A interface foi exercitada em 280, 320, 360, 480 e 800 pixels, incluindo orientação, download, importação, comparação, confirmação de envio, recuperação e erro de leitura. Não houve transbordamento horizontal da página. A logo local e o destino/atributos do link Zirtuno foram conferidos. A tabela tem rolagem própria e pode ser percorrida por teclado, com foco visível. Entrada de seção por ponteiro usa 180 ms; ativação por teclado e movimento reduzido não usam a animação. Nenhuma operação de escrita foi executada nessa conferência visual.

O relatório histórico ignorado pelo Git permanece em `.cache/panel-design/report.json`, junto do teste de conferência `.cache/panel-design-check.mjs`. As 30 capturas antigas dessa matriz foram removidas na limpeza da 0.3.4; as evidências atuais do fluxo e da prévia foram preservadas. As verificações da prévia local descritas abaixo foram realizadas na 0.3.0 e repetidas na 0.3.4; seu runtime não foi alterado nas versões 0.3.1/0.3.2/0.3.3. Esses resultados são fictícios e não ampliam a validação real.

## Diagnóstico do incidente

Os ZIPs anteriores tinham código e baseline internamente consistentes. A comparação por SHA-256 não comprovava completude do inventário remoto ou reprodução visual. O gerador antigo não capturava configurações/seções/catálogo visual, usava dados fictícios, eliminava referências remotas e inseria CSS compilado depois das regras personalizadas. Helpers ignoravam argumentos e a leitura de imagens já em cache podia manter o estado de carregamento. Produtos e categorias de demonstração tinham destinos genéricos.

A correção fica no exportador e no runtime gerado; os arquivos exportados não são alterados para ocultar falhas do simulador. Projetos privados de lojas não foram sobrescritos nesta tarefa. Não foi copiado conteúdo de lojas para este repositório.

## Resultados atuais

- 145 testes unitários passaram, em dez arquivos. Incluem parser estático sem eval/getters, Unicode e JSON/base64, allowlist e segredos, URLs privadas, redirecionamento/streaming/limites, SVG ativo, CSS/imports/fonts, hashes, originais byte a byte, exclusão de preview, helpers, configuração local, updater, navegação da orientação, concorrência/cache/compactação e permissões/isolamento do worker. Os casos anteriores de preflight, backup, conflito, cancelamento, gravação parcial e restauração permanecem ativos.
- `npm run test:e2e` passou no painel lateral nativo, com CodeMirror antigo/atual, captura textual/PNG sem mutações, projeto portátil, importação, envio fictício/backup/reload, conflito na restauração e reconexão. A etapa visual também passa pelo painel real, autorização por origem, worker autenticado e captura estática até gerar ZIP com cinco páginas e seis registros de recursos. Respostas públicas são fornecidas exclusivamente pela fixture dentro do perfil temporário.
- `npm run test:preview` passou para duas lojas fictícias distintas, escura/clara: cinco páginas e seis registros de recursos por loja (quatro SVGs originais, folha de fontes e WOFF2 original). O alias, cores, tipografia, nomes, produtos, categorias e rotas são diferentes.
- Cada ZIP foi extraído, movido a uma segunda pasta, teve a extração original removida e executou as ferramentas do próprio ZIP com `npm ci`, `check:integrity`, `check` e `pack`. Não usa ferramentas/caches do exportador para executar a prévia. O acesso à vitrine/CDN é bloqueado no navegador local após a instalação.
- Valores computados de fundo, texto, contorno/preenchimento, peso 700, CSS personalizado e espaçamento de letras foram conferidos. Imagens têm dimensões naturais válidas, classes `-loading` somem, callbacks de imagem em cache completam, fontes e ícone estão carregados, filtros usam preços da amostra e mudança de SKU usa o preço selecionado.
- Dois destinos de produto e dois de categoria foram abertos por seus links distintos em cada loja e exibiram os títulos/dados correspondentes. Home e os demais templates configurados passaram na compilação; páginas exercitadas não tiveram erros/avisos Vue não tratados ou requisições externas.
- Quatro comparações visuais: home escura/clara, desktop 1200×900 e mobile 390×844, após fontes/imagens carregarem. Referência independente de Twig/Vue/helpers locais. Mesmo estado, página e viewport. Dimensões iguais e diferença de pixels **0%** nas quatro comparações, com tolerância de canal 8 e limite de aceitação 1%.
- O retorno contém somente `tema/`, `.yampi-sync/baseline/` e `.yampi-sync/manifest.json`; originais e textos foram comparados byte a byte. Preview, catálogo auxiliar, fontes, ferramentas, relatórios e dependências não entram no retorno.

Evidências reproduzíveis, geradas e ignoradas pelo Git: `.cache/visual-validation/report.json`, `dark-desktop-reference.png`, `dark-desktop-local.png`, equivalentes mobile e light, HTML/CSS/medidas das fixtures e capturas do painel em `.cache/panel-*-e2e.png`. O relatório registra o alcance fictício e `realStoreVisualValidation: false`.

## Arquivos envolvidos

| Área | Arquivos principais |
|---|---|
| Formato/captura visual | `src/core/preview.ts`, `src/browser/preview-capture.ts`, `src/browser/public-fetch.ts` |
| Integração/permissões | `src/browser/background.ts`, `adapter.ts`, `bridge.ts`, `src/panel.ts`, manifesto e HTML do painel |
| ZIP/gerador | `src/core/archive.ts`, `compression.ts`, `local-kit.ts`, `src/browser/zip-client.ts`, `zip-worker.ts` |
| Prévia portátil | `local-runtime/dev.mjs`, `preview.mjs`, `integrity.mjs`, `engine.mjs`, `platform.mjs`, `platform-browser.mjs`, package/lock |
| Atualização | `scripts/update-project.mjs`, `runtime-versions.json` |
| Regressões | `tests/preview.test.ts`, `performance.test.ts`, fixtures visuais, testes de worker/runtime, `scripts/preview-e2e.mjs`, `e2e.mjs`, `compression-e2e.mjs`, driver do painel |
| Distribuição/documentação | build, package/lock raiz, README, instalação, validação, roadmap e licenças |

## Reproduzir

```powershell
npm ci
npm run check
npm run test:e2e
npm run test:preview
npm run test:compression
npm run audit:performance
npm run package
```

Os testes de navegador usam Chromium instalado pelo Playwright. Portas de teste são efêmeras, sem interromper um servidor de projeto já aberto. O pacote distribuído usa allowlist e não contém a fixture, driver, mock do worker ou exports. Acorn e fflate têm licença incluída.

## Nova exportação e projetos existentes

Recarregue a extensão 0.3.6 na mesma pasta instalada, feche o painel antigo e recarregue o editor sem rascunhos pendentes. Confira a loja e confirme a cópia com captura visual habilitada. Autorize somente as origens apresentadas; se negar, a extensão indica a prévia parcial/demonstrativa. Extraia em uma pasta nova e execute os quatro comandos de integridade, compilação, prévia e retorno descritos no README.

Para trocar apenas ferramentas antigas, use `node scripts/update-project.mjs "C:/projeto"` e depois `--apply`. Dry-run não escreve. Ferramentas modificadas pelo usuário e dependências diferentes são recusadas antes da gravação; scripts personalizados, dados, configuração, tema, baseline e manifesto são preservados. Backup/journal precedem a atualização, com rechecagem contra edições concorrentes. Uma atualização não inventa contexto ausente: uma nova captura separada é necessária para isso.

## Limitações e validação real

Configuração declarativa do editor é priorizada quando disponível. Complementos publicados podem diferir do rascunho; o vínculo independente ao tema exato não foi comprovado. A captura visual é uma amostra limitada, não um backup de catálogo/configurações operacionais. JSON dinâmico, recursos recusados, limites e falhas constam no diagnóstico. CSS importado em ciclo é recusado explicitamente, preservando as outras regras. Unknown modules e capacidades sem backend têm erro/limitação visível.

Os testes sintéticos acima validam a implementação nos cenários descritos. Não certificam fidelidade de uma loja real, todo componente, plugin ou regra de negócio. Inventário remoto independente, redes lentas reais, imagens/formatos reais, nova exportação visual real e gravação/restauração real ainda precisam de validação específica. Não se deve classificar uma exportação real como visualmente validada com base em HTTP 200, compilação ou hashes internos.

## Histórico da versão 0.2.4

Execução local em 08/10/2026, Node.js 24.15.0, Windows. Os testes usam somente dados fictícios.

## Verificações reproduzíveis

```powershell
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
npm run package
```

Os 118 testes de unidade cobrem comparação entre original/local/remoto, hashes, limites de extração, caminhos Windows, imagens, exportação antiga, importação da pasta inteira, ZIP com pasta externa, integridade da origem, preflight, backup, cancelamento, envio parcial, isolamento de sessões e histórico por loja. Incluem reconhecimento das duas associações DOM do CodeMirror pela API da instância, documento vazio, BOM, acentos, linhas finais, documento longo, leitura inconsistente e documento alterado durante a cópia. A captura não acessa operações de gravação; falha e cancelamento não produzem uma exportação parcial como completa. Locks de leitura recusam gravações antes da injeção, e a autorização de envio expira ao terminar. A conexão inclui heartbeat autenticado, parada ao fechar, erro sem repetição de escrita, recriação do port após desconexão e proteção do lock quando um port antigo encerra. O runtime local também é verificado contra leitura de arquivos fora do tema, links, escrita HTTP e hosts externos.

Na 0.2.4 foram acrescentados casos fictícios para painel global desativado, navegação, fechamento sem liberar uma gravação em andamento, nome do editor e nomes reservados Windows, workspace portátil, entradas Sass e variável de assets, dados por página, `filter`/`map` Twig com funções de seta, escaping, aliases Vue, templates funcionais e rejeição de módulos desconhecidos e HTML com bindings inválidos.

O teste de navegador instala uma cópia temporária da extensão Manifest V3 em um perfil Chromium próprio. Toda requisição à origem do painel Yampi é interceptada e substituída pelo editor fictício; requisições externas não previstas são abortadas. A cópia temporária recebe uma permissão de host exclusiva do teste. A extensão distribuída continua usando `activeTab`, sem essa permissão adicional.

O fluxo verificado inclui documento com 2.000 linhas, nomes iguais em diretórios diferentes, PNG, projeto exportado instalado com `npm ci`, compilação Twig/Sass/Vue 2 e CSS scoped, interação Vue no navegador, slots funcionais com getter Vuex, carregamento de imagem e clique na galeria, imagem servida localmente, seleção real da pasta com dependências ignoradas, ZIP de retorno, arquivo novo bloqueado, backup persistido/baixado, gravação e conferência após reload, histórico após reabrir o painel, proteção de uma alteração posterior durante restauração, rejeição de origem adulterada e zero acionamentos de publicação.

O teste usa o painel lateral nativo (`SIDE_PANEL` real), acionado pelo mesmo handler de produção a partir de um clique em uma página auxiliar exclusiva da cópia temporária. Abrir e reabrir pelo ícone deixa zero arquivos abertos e zero downloads até clicar em **Confirmar e baixar ZIP**. A exportação usa somente comandos de contexto, inventário e leitura, sob lock de leitura. Contadores e a comparação do conteúdo persistido confirmam zero edições, salvamentos e acionamentos de exclusão, renomeação, criação e publicação durante a cópia. A leitura integral passa com CodeMirror 6.36.2 (`cmView/rootView`) e com a versão atual fixada no lockfile (`cmTile/root`). Essas bibliotecas executam somente no editor fictício; não são incluídas no pacote da extensão.

Também verifica comparação automática ao importar, confirmação do destino após revisão, persistência através do reload e ausência de nova exportação ao recarregar o painel. O editor fictício fica em um Shadow DOM aberto. Títulos diferentes e controles semelhantes fora do componente não interferem na exportação. Múltiplos componentes, Shadow DOM fechado, rascunho em aba inativa, troca de loja e substituição do componente durante a leitura são recusados. Identidade ambígua mantém o erro original visível mesmo após desconexão forçada; retry recria o port e reconecta. Uma mensagem periódica real alcança o worker durante o teste. A página auxiliar, sua permissão, controles de desconexão e o driver CDP não fazem parte do pacote distribuído.

## Estado do painel real

A análise do [módulo público do editor Yampi](https://lisa.yampi.com.br/web-component-550f3324.mjs), em 08/10/2026, confirmou o componente `yampi-code-editor`, Shadow DOM aberto, cabeçalho, árvore, CodeMirror e indicadores de carregamento/rascunho. Confirmou também a associação `cmView/rootView`, incompatível com a descoberta de instância da biblioteca mais recente antes usada pela extensão. A versão 0.2.3 encontra a instância pela associação correspondente e valida com `findFromDOM` da própria página. Somente os seletores e o comportamento observado orientaram o adaptador; o módulo da Yampi e o HTML de uma sessão real não integram o repositório nem o pacote.

O proprietário relatou que a versão 0.2.2 reconheceu o editor e abriu arquivos, mas falhou na leitura completa do CodeMirror. Em 08/10/2026, relatou a conclusão de uma exportação textual real com a versão 0.2.3 e forneceu seu ZIP. Fora deste repositório público, a análise do pacote confirmou os tamanhos e hashes entre manifesto, original e tema local. O ZIP de retorno foi aceito pelo importador da extensão com conteúdo e origem preservados. O tema e os relatórios dessa loja permanecem no projeto privado expressamente solicitado pelo proprietário.

Essa conferência não compara independentemente cada arquivo com o editor remoto nem certifica que todo inventário dinâmico foi capturado em qualquer condição de rede. O pacote recebido não permitiu validar imagens reais. Gravações, reload e restauração reais continuam sem teste; os testes de escrita acima são fictícios. A análise de JavaScript público não substitui esses testes.

Na 0.2.3 o teste de compilação da prévia com o projeto real falhou. A 0.2.4 corrige as dependências identificadas com implementações genéricas e testes fictícios. No projeto privado, as cinco páginas passaram na compilação e em Chromium: HTML 200, componentes Vue ativos, sem erros ou avisos Vue e sem requisições externas. A home e a página de produto também passaram em viewport móvel de 390×844; a galeria concluiu o carregamento e a imagem abriu e fechou sem erros. Os hashes do tema e dos originais permaneceram iguais. Esse resultado cobre as páginas configuradas e seus dados fictícios; não certifica o backend, configurações reais, recursos não presentes no ZIP ou toda interação possível da loja. Nenhum código ou dado do projeto real foi incorporado aos testes públicos.

Uma próxima validação real deve começar pela exportação e conferência do inventário. Qualquer teste real de gravação depende de instruções específicas do proprietário sobre a loja de teste e o arquivo escolhido. Nunca publique automaticamente. A prévia local é parcial e utiliza dados fictícios; não substitui a prévia final da Yampi.

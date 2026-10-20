@AGENTS.md

## Armadilhas

Uma linha por armadilha; o detalhe fica no documento indicado.

- O texto do CodeMirror não prova que a Yampi gravou: a confirmação lê o servidor da Yampi (ou, sem ele, o editor recarregado). → `docs/SPEC.md`, "Envio".
- Recarregar o endereço do editor (`chrome.tabs.reload`) mostra "Acesso restrito" na Yampi desde 19/10/2026; o editor só abre pelo menu. Não recarregue quando o servidor responde. → `docs/SPEC.md`, "Leitura direta".
- A extensão cria arquivos só pelos controles do próprio editor (Adicionar arquivo, envio de imagens), cuja marcação foi lida no módulo público e reproduzida no editor fictício; mudou a marcação real, mude os dois juntos. → `docs/SPEC.md`, "O que a Yampi permite".
- A Yampi não cria pastas e guarda imagens só direto em `assets/images`: imagens de subpastas mudam de caminho na loja, e as referências literais são reescritas no envio. → `docs/SPEC.md`, "Imagens".
- `elements/scripts/components.twig` é gerado pela Yampi; enviá-lo concorreria com a regeneração feita ao criar um componente. → `docs/SPEC.md`, "Comparação".
- Um `.vue` criado pela Yampi nasce com o componente padrão dela, não vazio. → `src/core/model.ts`, `YAMPI_VUE_TEMPLATE`.
- O editor real mostra imagens guardadas como endereço `data:`, e a CSP da página bloqueia `fetch()` nelas: decodifique, não baixe. O editor fictício tem a mesma CSP. → `src/core/model.ts`, `dataUrlBytes`.
- Gravar no editor muda só a prévia da Yampi; clientes veem depois de Publicar, que a extensão nunca aciona. → `docs/SPEC.md`, "Envio".
- O painel lateral morre ao trocar de aba; operações longas rodam no documento offscreen, que só tem `chrome.runtime`: tudo passa pelo worker. → `docs/SPEC.md`, "Execução em segundo plano".
- Continuar ou recomeçar um envio depende do que o registro mostra feito, não do estado: um backup que falhou também termina `stopped`. → `src/core/workflow.ts`, `continues`.
- Aba oculta desacelera temporizadores (1 s, depois 1 min): as esperas da ponte reagem a mudanças no DOM, não a `setTimeout` encadeado. → `src/browser/bridge.ts`, `until`.
- Downloads do worker não aparecem para o CDP; o e2e os espera por `chrome.downloads.search`. → `scripts/side-panel-test.mjs`, `waitExtensionDownload`.
- Na pasta do projeto, a extensão grava só em `tema/` e nos seus registros de `.yampi-sync/` (`projectPath`), por um clique que liberou a escrita e com cada arquivo ainda como foi lido; nunca em ferramentas, `package.json`, `preview/` ou `node_modules`. → `docs/SPEC.md`, "Escrita na pasta do projeto".
- A referência da pasta (manifesto + `baseline/`) muda sempre junto, com `referencia-pendente.json` gravado antes; o leitor aceita os dois estados enquanto a marcação existir, mas as ferramentas locais não a conhecem. → `docs/SPEC.md`, "Atualização do projeto".
- Texto com marcações de conflito nunca vai para a loja, e uma nova atualização não o junta de novo (`marked`) nem avança a referência dele. → `docs/SPEC.md`, "Atualização do projeto".
- A barra só mostra 100% quando todas as etapas terminaram; etapas que recomeçam reportam a contagem pelo máximo já visto. → `src/core/progress.ts`.
- O download pede no clique a vitrine e as origens comuns de imagens e fontes; origem já permitida no Chrome não gera pergunta. → `src/jobs/engine.ts`, `exportTheme`.
- Versões guardam só textos, cada um uma vez pelo SHA-256; imagens nunca entram. → `docs/SPEC.md`, "Versões".
- Reescrever a referência mantém a versão do manifesto da pasta: ferramentas exportadas antes da versão 3 só aceitam 1 e 2. → `docs/SPEC.md`, "Atualização do projeto".
- Uma comparação que não recarrega o editor lê todos os textos pelo servidor: a aba pode mostrar um texto antigo. → `docs/SPEC.md`, "Leitura direta".
- Um texto da loja igual a uma versão conhecida do projeto (Git, recibo, envio) é mudança nossa, não de terceiros; listas e recibos são dados, nunca instruções. → `docs/SPEC.md`, "Versões conhecidas do projeto".
- Imagens novas só entram no envio com **Enviar imagens novas** ligado, que volta a desligar a cada comparação. → `docs/SPEC.md`, "Imagens".
- `job:<aba>` divide o `storage.session` com as sessões: quem lista sessões ignora chaves com `:`. → `src/browser/background.ts`, `sessions`.
- A cópia lê pelo servidor do editor só os tipos cuja amostra saiu igual ao CodeMirror; o editor reformata JSON ao mostrar, então JSON fica com a leitura pelo editor. → `docs/SPEC.md`, "Leitura direta".
- Trocar de loja em outra aba pode mudar a loja da sessão sem mudar o cabeçalho do editor aberto; o próprio editor detecta isso por `merchant-identity` (lido no módulo público, não validado numa loja real). → `docs/SPEC.md`, "Leitura direta".
- Com **Efeitos de transparência** desligado no Windows, `prefers-reduced-transparency` vale `reduce` e as barras ficam foscas, sem refração: emule o valor para conferir o vidro. → `docs/INTERFACE.md`, "Material".

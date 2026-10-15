# Especificação — comparação e envio de textos

Contrato do que protege a loja. O README explica o uso; este arquivo diz o que o código deve garantir. `tests/core.test.ts` e `scripts/e2e.mjs` verificam estas regras com o editor fictício.

## Identidade

Toda operação compara a identidade lida no cabeçalho do editor — nome da loja, origem da vitrine e origem do editor — com a da exportação. Uma diferença interrompe antes da leitura ou gravação seguinte. O editor da Yampi só abre o tema instalado na loja; a identidade do tema não é lida.

## Comparação

Cada caminho recebe um estado a partir do original exportado (B), do arquivo local (L) e da loja no momento da comparação (R).

| Situação | Estado | Envio |
|---|---|---|
| L, R e B iguais | `unchanged` | — |
| L igual a R, diferente de B | `already-applied` | — |
| L diferente de B, R igual a B, texto compatível | `update` | sim |
| L igual a B, R diferente | `remote-only` | não: a loja é preservada |
| L, R e B diferentes | `conflict` | não |
| sem L | `missing-local` | não: nada é excluído |
| B e L existem, sem R | `missing-remote` | não: nada é recriado |
| L novo, sem R | `new-local` | texto: bloqueia todo envio (veja "Arquivos novos") |
| L novo, R igual a L | `already-applied` | — |
| L novo, R vazio ou só espaços, texto compatível | `update` | sim: preenche o arquivo |
| L novo, R diferente e com conteúdo | `conflict` | não |
| fora de `.twig`, `.vue`, `.css` e `.scss` | `unsupported` | não |

Imagens recebem os mesmos estados por comparação de bytes, mas nunca são enviadas.

## Arquivos novos

A extensão não cria, renomeia nem exclui arquivos ou pastas. Um texto novo é criado vazio, à mão, no editor da Yampi, na pasta indicada pelo caminho. Na comparação seguinte ele aparece como `update`, e a extensão grava o conteúdo com as mesmas garantias de qualquer envio.

Enquanto existir texto local novo sem arquivo correspondente na loja, nenhum envio começa: os arquivos alterados podem incluí-lo (Twig), importá-lo (Sass) ou montá-lo (Vue), e a prévia da Yampi quebraria. Imagens novas não bloqueiam o envio de textos; são enviadas à mão pelo editor da Yampi.

`elements/scripts/components.twig` é gerado pela Yampi a partir dos componentes existentes: criar o `.vue` no editor da Yampi o registra. Alterações locais nesse arquivo são sobrescritas pela Yampi.

## Envio

1. Somente linhas `update` de uma comparação desta sessão, sem duplicatas. A confirmação exige digitar o nome da loja.
2. O editor é recarregado e todos os selecionados são relidos. Qualquer diferença do estado comparado interrompe antes de gravar.
3. O registro (`prepared`) e o backup dos selecionados são gravados no IndexedDB, e o download do backup é confirmado. Sem os dois, nada é gravado.
4. Os arquivos novos são preenchidos primeiro; os demais seguem a ordem dos caminhos. Para cada arquivo: recarregar o editor, conferir dentro da página o conteúdo esperado, salvar, recarregar de novo e reler o arquivo da Yampi. Só então ele entra em `verified` e o próximo começa.
5. No fim, o editor é recarregado e todos os enviados são relidos.
6. Qualquer falha para no arquivo em andamento, registrado em `pending`, com estado `stopped`. Nada é desfeito nem repetido automaticamente.

A extensão nunca aciona Publicar. Salvar no editor muda a prévia da Yampi; os clientes só veem a mudança depois de Publicar, feito à mão ([documentação da Yampi](https://docs.yampi.com.br/editor-codigo/como-fazer/primeiras-edicoes)).

## Restauração

Usa o registro de um envio: o conteúdo enviado passa a ser o original e o anterior passa a ser o local. Só volta o arquivo que continua igual ao enviado; alterações posteriores aparecem como conflito. Um arquivo novo preenchido volta a ficar vazio; nada é excluído.

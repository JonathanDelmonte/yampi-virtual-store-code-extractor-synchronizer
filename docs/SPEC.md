# Especificação — comparação e envio

Contrato do que protege a loja. O README explica o uso; este arquivo diz o que o código deve garantir. `tests/core.test.ts` e `scripts/e2e.mjs` verificam estas regras com o editor fictício, que reproduz a marcação do editor real.

## Identidade

Toda operação compara a identidade lida no cabeçalho do editor — nome da loja, origem da vitrine e origem do editor — com a da exportação. Uma diferença interrompe antes da leitura ou gravação seguinte. O editor da Yampi só abre o tema instalado na loja; a identidade do tema não é lida.

## O que a Yampi permite

Regras lidas no módulo público do editor (15/10/2026) e reproduzidas no editor fictício:

- **Adicionar arquivo**, no botão de cada pasta, cria `<pasta>/<nome>.<extensão>` numa pasta que já existe, com extensão SCSS, Vue, Twig ou JS e nome só com letras, números, `_` e `-`. Um `.vue` novo nasce com o componente padrão da Yampi; os demais, vazios. Tudo vai para o rascunho (`preview=true`).
- Na pasta `assets/images`, o mesmo botão abre o envio de imagens: PNG, JPEG, WebP ou SVG de até 2 MB, salvas sempre em `assets/images/<nome>`, com o nome em minúsculas e outros caracteres trocados por `-`.
- Não há criação de pastas nem substituição de imagem.
- `elements/scripts/components.twig` é gerado pela Yampi com os componentes existentes.

## Comparação

Cada caminho recebe um estado a partir do original exportado (B), do projeto local (L) e da loja no momento da comparação (R). L é comparado como chegará à loja: com as imagens já no lugar aceito pela Yampi e as referências ajustadas (veja "Imagens").

| Situação | Estado | Envio |
|---|---|---|
| L, R e B iguais | `unchanged` | — |
| L igual a R, diferente de B | `already-applied` | — |
| L diferente de B, R igual a B, texto compatível | `update` | sim |
| L igual a B, R diferente | `remote-only` | não: a loja é preservada |
| L, R e B diferentes | `conflict` | só por escolha explícita (abaixo) |
| sem L | `missing-local` | não: nada é excluído |
| B e L existem, sem R | `missing-remote` | não: nada é recriado |
| texto novo, sem R, pasta existente, nome e tipo aceitos | `create` | sim: a extensão cria e preenche |
| texto novo, sem R, pasta inexistente ou nome/tipo recusado | `new-local` | bloqueia todo envio, com o motivo |
| texto novo, R vazio, só espaços ou componente padrão da Yampi | `update` | sim: preenche |
| imagem nova, sem R | `upload` | sim: a extensão envia |
| imagem existente alterada | `unsupported` | não: a Yampi não substitui imagens |
| `elements/scripts/components.twig` alterado | `unsupported` | não: a Yampi gera esse arquivo |
| fora de `.twig`, `.vue`, `.css` e `.scss` | `unsupported` | não |

Um conflito em texto pode ser resolvido pelo usuário, arquivo a arquivo, com **Usar a versão do projeto**, depois de ver as três versões. O arquivo passa a `update` com a versão da loja no backup. Sem essa escolha, fica a versão da loja.

## Dependências

Um arquivo enviado não pode depender de um arquivo que não existirá na loja. O analisador lê `@import`/`@use`/`@forward`, `include`/`embed`/`extends`/`import`/`from`, `get_section_file`, `assets_url`/`asset()`, imports `.vue` e componentes usados por tag. Arquivos com estado `create` ou `upload` contam como existentes.

- Uma dependência que não existirá bloqueia quem a usa (`blocked-dependency`, com os dois nomes).
- Arquivos alterados que se usam vão juntos; um envio parcial é recusado antes de gravar.
- Diferenças só de espaço em branco aparecem separadas, sem seleção inicial, e nunca acoplam outros arquivos.

## Imagens

A Yampi guarda imagens só direto em `assets/images`. Uma imagem nova em outra pasta, ou com nome que a Yampi trocaria, recebe um caminho lá: o próprio nome normalizado, ou as pastas unidas por `-` quando esse nome já pertence a outra imagem. Imagens que a loja já tem nunca mudam de lugar.

Toda referência literal ao caminho completo antigo (`images/hero/a.jpg`, inclusive em `../images/hero/a.jpg`) passa a apontar para o novo, em todos os textos do projeto, de forma determinística: comparar de novo dá o mesmo resultado. Um texto que ainda aponta para a pasta antiga depois disso — caminho montado em tempo de execução, ou relativo a `images/` — fica bloqueado, com o motivo. O projeto local não muda: a prévia continua usando as subpastas.

## Envio

1. Somente linhas `update`, `create` e `upload` de uma comparação desta sessão, sem duplicatas e com os arquivos acoplados juntos. Texto novo que a Yampi não permite criar bloqueia todo o envio.
2. Confirmação explícita, com o nome da loja à vista.
3. O editor é recarregado. Os textos existentes selecionados são relidos, e os caminhos novos precisam continuar livres. Qualquer diferença interrompe antes de gravar.
4. O registro (`prepared`) e o backup dos textos existentes são gravados no IndexedDB, e o download do backup é confirmado. Sem os dois, nada é gravado.
5. Cada item é feito e conferido antes do próximo, nesta ordem:
   1. criar os textos novos pelo **Adicionar arquivo** e conferir, após recarregar, que existem com o conteúdo inicial da Yampi;
   2. enviar as imagens pelo envio de imagens do editor e conferir os bytes após recarregar;
   3. preencher os textos novos e depois os demais: recarregar, conferir dentro da página o conteúdo esperado, salvar, recarregar e reler.
6. No fim, o editor é recarregado e todos os textos enviados são relidos. A ausência de um componente criado em `components.twig` vira aviso, sem desfazer o envio.
7. Qualquer falha para no item em andamento, registrado em `pending`, com estado `stopped`. Nada é desfeito nem repetido automaticamente.

A extensão nunca aciona Publicar, Excluir ou Renomear. Salvar no editor muda a prévia da Yampi; os clientes só veem a mudança depois de Publicar, feito à mão ([documentação da Yampi](https://docs.yampi.com.br/editor-codigo/como-fazer/primeiras-edicoes)).

## Restauração

Usa o registro de um envio: o conteúdo enviado passa a ser o original e o anterior passa a ser o local. Só volta o arquivo que continua igual ao enviado; alterações posteriores aparecem como conflito. Um texto criado pela extensão volta ao conteúdo inicial da Yampi. Nada é excluído: arquivos criados e imagens enviadas continuam na loja.

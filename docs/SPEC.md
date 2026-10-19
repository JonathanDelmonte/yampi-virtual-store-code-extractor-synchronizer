# Especificação — comparação e envio

Contrato do que protege a loja. O README explica o uso; este arquivo diz o que o código deve garantir. `tests/core.test.ts`, `tests/resume.test.ts`, `tests/jobs.test.ts` e `scripts/e2e.mjs` verificam estas regras com o editor fictício, que reproduz a marcação do editor real.

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

### Leitura da loja

A comparação abre na loja só os caminhos que o projeto mudou e os textos que eles usam: textos diferentes do original, crus ou depois do ajuste das referências de imagem; imagens com bytes diferentes, com os dois nomes possíveis de uma imagem que muda de pasta; e os textos incluídos, importados ou usados como componente por esses textos, porque um texto que só a loja mudou continua bloqueando quem o usa. Os demais caminhos são listados, não abertos, e entram como iguais ao original (`assumed`): o projeto não os mudou, então nunca são enviados, e a listagem ainda mostra o que a loja tem a mais ou a menos. Alt+clique em **Comparar de novo** lê o tema inteiro.

### Leitura direta

Desde a 0.7.0, a cópia e a comparação leem o conteúdo pelo servidor do próprio editor, a partir da página do editor: `GET https://bart.yampi.com.br/v1/merchant/file/get?path_file=<caminho>&preview=true`, o mesmo pedido que o editor faz ao abrir um arquivo (módulo público do editor, lido em 18/10/2026), com os cookies que o navegador envia a esse servidor. A extensão não lê, guarda nem envia cookie ou token. A árvore do editor continua dizendo quais arquivos existem. São até 6 pedidos de cada vez e até 24 caminhos por chamada. `tests/direct.test.ts`, `scripts/e2e.mjs` e `scripts/direct-e2e.mjs` verificam as regras com um servidor fictício.

- **Mesma loja.** Antes de começar, nome e link de prévia informados pelo servidor (`/merchant/theme/data-merchant-theme`) têm de ser os do cabeçalho. A loja da sessão (`/merchant/theme/merchant-identity`, a consulta que o editor faz ao voltar à aba) é conferida antes e depois de cada chamada e no fim. Se mudar, a cópia para sem entregar nada: o editor também passaria a abrir os arquivos da outra loja.
- **Igual ao editor.** O texto chega como o CodeMirror o guarda: `\r\n` e `\r` viram `\n`. JSON, que o editor reformata ao mostrar, e extensões de imagem fora de `assets/` são lidos pelo editor. Para imagens, o servidor devolve o endereço que o editor exibe; valem as regras da leitura pela prévia: `https:` ou `data:` decodificado, tipo conferido pelos bytes.
- **Amostra antes do restante.** O primeiro arquivo de cada tipo (cada extensão de texto, e imagem) é lido pelos dois caminhos. Só os tipos idênticos seguem pelo servidor; uma diferença manda tudo para a leitura pelo editor.
- **Recuo em vez de parada.** Servidor indisponível, resposta inesperada, sessão expirada ou falha no meio devolvem o restante à leitura pelo editor, com o motivo nas etapas. Só a troca de loja interrompe.
- **Só leitura de cópia.** Com menos de 8 arquivos elegíveis, tudo vai pelo editor. Envio, preflight, criação, conferência após recarregar e restauração continuam lendo pelo editor.

Depois de um envio, a referência da comparação avança: cada texto conferido e cada imagem enviada passam a ser o original. O que já foi enviado não volta como conflito, e o registro do envio fica ligado à exportação.

## Dependências

Um arquivo enviado não pode depender de um arquivo que não existirá na loja. O analisador lê `@import`/`@use`/`@forward`, `include`/`embed`/`extends`/`import`/`from`, `get_section_file`, `assets_url`/`asset()`, imports `.vue` e componentes usados por tag. Arquivos com estado `create` ou `upload` contam como existentes.

- Uma dependência que não existirá bloqueia quem a usa (`blocked-dependency`, com os dois nomes).
- Um texto que só a loja mudou (`remote-only`) ou que está em conflito também bloqueia os arquivos alterados que o usam: eles foram escritos contra a versão do projeto. O painel diz qual arquivo mudou e onde, e mostra a mudança. A versão da loja vai para o projeto só quando o usuário pede: **Usar no projeto** grava na pasta lembrada, ou **Copiar** para colar à mão.

## Escrita na pasta do projeto

É a única escrita da extensão fora da loja (`replaceThemeFile`), sempre por um clique do usuário num arquivo que só a loja mudou:

- o Chrome pede a permissão de escrita naquele clique; sem ela, nada é gravado e a cópia continua disponível;
- só um arquivo de `tema/` que já existe é trocado: nada é criado, nem pastas, e caminhos com `..` são recusados;
- o arquivo precisa continuar como na comparação (lido como o projeto é lido, com quebras de linha `\n`); se mudou, nada é gravado;
- as quebras de linha e a marca de ordem de bytes do arquivo são mantidas;
- depois, a pasta é relida e comparada de novo.
- Arquivos alterados que se usam vão juntos; um envio parcial é recusado antes de gravar.
- Diferenças só de espaço em branco aparecem separadas, sem seleção inicial, e nunca acoplam outros arquivos.

## Imagens

A Yampi guarda imagens só direto em `assets/images`. Uma imagem nova em outra pasta, ou com nome que a Yampi trocaria, recebe um caminho lá: o próprio nome normalizado, ou as pastas unidas por `-` quando esse nome já pertence a outra imagem. Imagens que a loja já tem nunca mudam de lugar.

Toda referência literal ao caminho completo antigo (`images/hero/a.jpg`, inclusive em `../images/hero/a.jpg`) passa a apontar para o novo, em todos os textos do projeto, de forma determinística: comparar de novo dá o mesmo resultado. Um texto que ainda aponta para a pasta antiga depois disso — caminho montado em tempo de execução, ou relativo a `images/` — fica bloqueado, com o motivo. O projeto local não muda: a prévia continua usando as subpastas.

## Envio

1. Somente linhas `update`, `create` e `upload` da comparação confirmada, sem duplicatas e com os arquivos acoplados juntos. Texto novo que a Yampi não permite criar bloqueia todo o envio.
2. Confirmação explícita, com o nome da loja à vista.
3. O editor é recarregado. Os textos existentes selecionados são relidos e precisam estar como na comparação, e os caminhos novos precisam continuar livres. Qualquer diferença interrompe antes de gravar.
4. O registro (`prepared`) e o backup dos textos existentes são gravados no IndexedDB, e o download do backup é confirmado. Sem os dois, nada é gravado.
5. Cada etapa termina conferida antes da seguinte, nesta ordem:
   1. criar os textos novos pelo **Adicionar arquivo**, cada um listado pelo editor antes do próximo; depois, uma recarga e a conferência de que todos existem com o conteúdo inicial da Yampi;
   2. enviar as imagens pelo envio de imagens do editor, do mesmo jeito; depois, uma recarga e a conferência dos bytes de cada uma;
   3. preencher os textos novos e depois os demais, um por vez: conferir dentro da página o conteúdo esperado, salvar, recarregar e reler antes do próximo.
6. No fim, todos os textos enviados são relidos da loja. A ausência de um componente criado em `components.twig` vira aviso, sem desfazer o envio.
7. Qualquer falha para no item em andamento, registrado em `pending`, com estado `stopped`. Nada é desfeito. Criações, envios de imagem e salvamentos nunca são repetidos automaticamente; leituras e recargas que falham por instabilidade do editor (prazo esgotado, recarga incompleta, quadro removido) são tentadas até três vezes.

Logo depois de uma recarga, o editor mostra a versão do servidor. Ele só é recarregado de novo quando algo mudou desde a última recarga: a recarga que confere um texto salvo é o ponto de partida do próximo, e a conferência final não precisa de outra. A ordem e as conferências acima não mudam.

Um item criado ou enviado e ainda não conferido fica em `issued`, até a conferência do seu grupo.

### Continuar um envio interrompido

**Continuar de onde parou** aparece para o último envio não concluído da loja que guardou o plano confirmado (`sendplan:<registro>`). Usa a mesma seleção; outra é recusada.

- Se o registro não mostra nenhuma alteração (nada conferido, criado, enviado, em `issued` ou em `pending`), o envio recomeça do passo 3, com nova conferência e novo backup, no mesmo registro. Um backup que falhou também termina como `stopped`, por isso a decisão vem do que foi feito, não do estado.
- Senão, continua. O que já foi conferido não é refeito. Um texto novo ou uma imagem que já está na loja é conferido no seu grupo, não criado de novo; um texto novo já preenchido pela execução anterior conta como criado. Antes de salvar cada texto restante, a versão da loja é lida: igual à do projeto, conta como conferido; igual à de antes do envio, é salvo; diferente das duas, o envio para sem gravar.
- Cada continuação é anotada em `resumedAt`. A conferência final relê todos os textos, inclusive os da execução anterior.

### Execução em segundo plano

Baixar, comparar e enviar rodam num documento da extensão (`runner.html`, criado com `chrome.offscreen`), não no painel.

- O worker mantém o bloqueio da aba enquanto a operação roda. Fechar o painel ou trocar de aba não o libera nem interrompe nada; outro painel da mesma aba só acompanha. O estado da operação (`job:<aba>`, no armazenamento da sessão) é a fonte do painel reaberto, do ícone e do aviso de fim.
- O documento só conversa com o worker. O worker aceita dele apenas comandos da operação em andamento, para a aba que recebeu, e confere o endereço do editor em cada um, como faz com o painel.
- Downloads: o documento cria o arquivo; o worker baixa só endereços `blob:` da própria extensão, com nome restrito, e espera o fim do download antes de seguir.
- **Interromper** para depois do item em andamento. Fechar a aba do editor cancela a operação. Reiniciar ou atualizar a extensão encerra a operação como falha, sem desfazer nada, e o envio pode continuar (acima).
- A aba não é descartada pelo navegador enquanto a operação roda. Em segundo plano, o navegador desacelera os temporizadores da página; as esperas do editor respondem a mudanças na página, e a operação continua, mais devagar.

A extensão nunca aciona Publicar, Excluir ou Renomear. Salvar no editor muda a prévia da Yampi; os clientes só veem a mudança depois de Publicar, feito à mão ([documentação da Yampi](https://docs.yampi.com.br/editor-codigo/como-fazer/primeiras-edicoes)).

## Restauração

Usa o registro de um envio: o conteúdo enviado passa a ser o original e o anterior passa a ser o local. Só volta o arquivo que continua igual ao enviado; alterações posteriores aparecem como conflito. Um texto criado pela extensão volta ao conteúdo inicial da Yampi. Nada é excluído: arquivos criados e imagens enviadas continuam na loja.

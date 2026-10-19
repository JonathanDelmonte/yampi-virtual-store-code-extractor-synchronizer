# Especificação — comparação e envio

Contrato do que protege a loja. O README explica o uso; este arquivo diz o que o código deve garantir. `tests/core.test.ts`, `tests/resume.test.ts`, `tests/jobs.test.ts` e `scripts/e2e.mjs` verificam estas regras com o editor fictício, que reproduz a marcação do editor real. A atualização da pasta e as versões são verificadas por `tests/merge.test.ts`, `tests/update.test.ts`, `tests/versions.test.ts`, `tests/images-off.test.ts` e `scripts/update-e2e.mjs`.

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
| imagem nova, sem R, com **Enviar imagens novas** ligado | `upload` | sim: a extensão envia |
| imagem nova, sem R, com a opção desligada (padrão) | `new-local`, com o motivo | não; um texto que a usa fica bloqueado |
| texto com marcações de conflito (`<<<<<<<` … `=======` … `>>>>>>>`) | `blocked-dependency`, com o motivo | não: resolva no editor de código |
| imagem existente alterada | `unsupported` | não: a Yampi não substitui imagens |
| `elements/scripts/components.twig` alterado | `unsupported` | não: a Yampi gera esse arquivo |
| fora de `.twig`, `.vue`, `.css` e `.scss` | `unsupported` | não |

Um conflito em texto pode ser resolvido pelo usuário, arquivo a arquivo, com **Usar a versão do projeto**, depois de ver as três versões. O arquivo passa a `update` com a versão da loja no backup. Sem essa escolha, fica a versão da loja.

Diferenças só de espaço em branco aparecem separadas, sem seleção inicial, e nunca acoplam outros arquivos.

### Leitura da loja

A comparação abre na loja só os caminhos que o projeto mudou e os textos que eles usam: textos diferentes do original, crus ou depois do ajuste das referências de imagem; imagens com bytes diferentes, com os dois nomes possíveis de uma imagem que muda de pasta; e os textos incluídos, importados ou usados como componente por esses textos, porque um texto que só a loja mudou continua bloqueando quem o usa. Os demais caminhos são listados, não abertos, e entram como iguais ao original (`assumed`): o projeto não os mudou, então nunca são enviados, e a listagem ainda mostra o que a loja tem a mais ou a menos. Alt+clique em **Comparar de novo** lê o tema inteiro.

### Leitura direta

Desde a 0.7.0, a cópia e a comparação leem o conteúdo pelo servidor do próprio editor, a partir da página do editor: `GET https://bart.yampi.com.br/v1/merchant/file/get?path_file=<caminho>&preview=true`, o mesmo pedido que o editor faz ao abrir um arquivo (módulo público do editor, lido em 18/10/2026), com os cookies que o navegador envia a esse servidor. A extensão não lê, guarda nem envia cookie ou token. A árvore do editor continua dizendo quais arquivos existem. São até 6 pedidos de cada vez e até 24 caminhos por chamada. `tests/direct.test.ts`, `scripts/e2e.mjs` e `scripts/direct-e2e.mjs` verificam as regras com um servidor fictício.

- **Mesma loja.** Antes de começar, nome e link de prévia informados pelo servidor (`/merchant/theme/data-merchant-theme`) têm de ser os do cabeçalho. A loja da sessão (`/merchant/theme/merchant-identity`, a consulta que o editor faz ao voltar à aba) é conferida antes e depois de cada chamada e no fim. Se mudar, a cópia para sem entregar nada: o editor também passaria a abrir os arquivos da outra loja.
- **Igual ao editor.** O texto chega como o CodeMirror o guarda: `\r\n` e `\r` viram `\n`. JSON, que o editor reformata ao mostrar, e extensões de imagem fora de `assets/` são lidos pelo editor. Para imagens, o servidor devolve o endereço que o editor exibe; valem as regras da leitura pela prévia: `https:` ou `data:` decodificado, tipo conferido pelos bytes.
- **Amostra antes do restante.** O primeiro arquivo de cada tipo (cada extensão de texto, e imagem) é lido pelos dois caminhos. Só os tipos idênticos seguem pelo servidor; uma diferença manda tudo para a leitura pelo editor.
- **Recuo em vez de parada.** Servidor indisponível, resposta inesperada, sessão expirada ou falha no meio devolvem o restante à leitura pelo editor, com o motivo nas etapas. Só a troca de loja interrompe.
- **Poucos arquivos.** Com menos de 8 arquivos elegíveis, a cópia lê tudo pelo editor.
- **Comparação sem recarregar (desde a 0.9.0).** Quando o servidor responde, a comparação lê pelo servidor todos os textos que ele entrega como o editor mostra, sem amostra e sem mínimo de arquivos: a aba aberta pode guardar um texto antigo. Se o servidor falhar no meio, a comparação para, sem cair para a leitura pelo editor.
- **Conferência do envio (desde a 0.8.1).** Com o servidor respondendo pela mesma loja, a comparação, o preflight, a conferência de cada arquivo salvo, criado ou enviado e a conferência final leem pelo servidor, e o editor não é recarregado: em 19/10/2026, recarregar o endereço do editor passou a mostrar a página "Acesso restrito" da Yampi, embora o editor abrisse pelo menu. A gravação continua pelo próprio editor, que confere o conteúdo esperado antes de salvar. Sem o servidor, o editor é recarregado como antes; se a recarga mostrar "Acesso restrito", a operação para na hora, com o motivo, e o envio pode continuar de onde parou.

Depois de um envio, a referência da comparação avança: cada texto conferido e cada imagem enviada passam a ser o original. O que já foi enviado não volta como conflito, e o registro do envio fica ligado à exportação. Desde a 0.8.0, a referência também avança na própria pasta do projeto (veja "Atualização do projeto").

## Dependências

Um arquivo enviado não pode depender de um arquivo que não existirá na loja. O analisador lê `@import`/`@use`/`@forward`, `include`/`embed`/`extends`/`import`/`from`, `get_section_file`, `assets_url`/`asset()`, imports `.vue` e componentes usados por tag. Arquivos com estado `create` ou `upload` contam como existentes.

- Uma dependência que não existirá bloqueia quem a usa (`blocked-dependency`, com os dois nomes).
- Um texto que só a loja mudou (`remote-only`) ou que está em conflito também bloqueia os arquivos alterados que o usam: eles foram escritos contra a versão do projeto. O painel diz qual arquivo mudou e onde, e mostra a mudança. A versão da loja vai para o projeto só quando o usuário pede: **Usar no projeto** grava na pasta lembrada, ou **Copiar** para colar à mão. Para trazer todas as mudanças da loja de uma vez, **Atualizar da loja** (veja "Atualização do projeto").
- Arquivos alterados que se usam vão juntos; um envio parcial é recusado antes de gravar.

## Escrita na pasta do projeto

A extensão grava na pasta do projeto só pela API de pastas do Chrome, e só os caminhos que `projectPath` aceita: `tema/` e, em `.yampi-sync/`, `manifest.json`, `baseline/`, `versoes/` e `referencia-pendente.json`. Ferramentas, `package.json`, `preview/`, `node_modules` e caminhos com `..` são recusados antes de chegar ao disco. O navegador grava cada arquivo num temporário e o troca ao fechar: nenhum arquivo fica pela metade.

- **Permissão no clique.** Atualizar a pasta, salvar uma versão, trazer arquivos de uma versão e **Usar no projeto** pedem a escrita no próprio clique; sem ela, nada é gravado. O registro de um envio na pasta só acontece se a escrita já estiver liberada (o clique em **Enviar agora** a pede): nunca há pedido fora de um clique.
- **Como foi lido.** Todo arquivo de `tema/` que a extensão troca ou remove precisa estar como na leitura que o usuário revisou, lido como o projeto é lido, com quebras de linha `\n`. Se mudou, nada é gravado.
- Um texto gravado sobre um arquivo existente mantém as quebras de linha `\r\n` e a marca de ordem de bytes desse arquivo.
- **Usar no projeto** troca só um arquivo de `tema/` que já existe e que só a loja mudou. A atualização e a recuperação de versões criam e removem arquivos de `tema/` (e pastas dentro dele), sempre depois da revisão; nunca fora de `tema/`.
- Depois de cada escrita, a pasta é relida.

## Atualização do projeto

**Atualizar da loja** traz para a pasta o que mudou na loja, antes de um trabalho novo, para que o próximo envio parta da loja como está. A operação em segundo plano só lê: é uma comparação com escopo `update`, que lê a loja inteira (textos e imagens) e guarda a leitura à parte da revisão do envio. O painel calcula o plano (`planUpdate`) com a referência (B), a pasta (L) e a loja lida (R). Nada é gravado até **Atualizar a pasta**.

| Situação | Estado | Na pasta |
|---|---|---|
| L igual a R | `same` | nada |
| L igual a B | `store` ou `removed` | recebe R, ou sai da pasta se a loja o removeu |
| R igual a B | `mine` | nada |
| B, L e R diferentes, em linhas diferentes | `merged` | recebe a junção |
| B, L e R diferentes nas mesmas linhas, ou em linhas vizinhas sem linha igual entre elas | `conflict` | escolha: marcações (padrão), `mine` ou `store` |
| removido na loja e editado na pasta | `removed-edited` | escolha: seguir a loja (padrão: sai da pasta) ou manter |
| apagado na pasta e mudado na loja | `deleted-changed` | escolha: seguir a loja (padrão: volta) ou continuar apagado |
| L ainda com marcações de conflito | `marked` | nada; a referência desse arquivo não avança |

Um texto da loja igual ao que um envio desta instalação deixou ali (registros de envio, só itens conferidos) não é mudança de outra pessoa: para esse arquivo, a referência passa a ser o texto da loja. Assim, um arquivo enviado e depois editado na pasta fica `mine`, não conflito, mesmo com a referência mais antiga que esse envio.

Nenhum padrão desfaz uma mudança feita na loja. **Manter a da pasta** num conflito é a escolha explícita daquele arquivo, com as versões à vista: depois da atualização ele fica `update` e vai no próximo envio, com a versão da loja no backup. Com marcações, o arquivo nunca é enviado (veja "Comparação"). Um arquivo ainda marcado não é juntado de novo; como a referência dele não avança, uma mudança mais nova da loja aparece como conflito depois de resolvido.

A junção é por linhas, como no Git (`mergeTexts`):
- mudanças da pasta e da loja em linhas diferentes ficam as duas, e a mesma mudança dos dois lados não é conflito;
- linhas iguais nas bordas de um conflito ficam fora das marcações;
- arquivos diferentes demais para a comparação detalhada viram conflito do trecho inteiro, nunca uma junção errada;
- imagens não são juntadas: a da loja entra só onde a pasta tinha a anterior, e uma imagem mudada na pasta fica.

Aplicar segue esta ordem, e uma parada em qualquer ponto não perde nada:

1. cada arquivo de `tema/` que vai mudar é conferido com a leitura revisada; um diferente para tudo antes da primeira gravação;
2. as versões são guardadas: a referência anterior, a pasta e a loja lida;
3. `tema/` muda: primeiro as remoções, depois as gravações, para que um nome que só muda de maiúsculas não perca o arquivo novo no Windows;
4. a referência passa a ser a loja lida (`writeReference`).

Parada depois do passo 3: os arquivos que a atualização trouxe já são iguais à loja, e a comparação os vê como já aplicados.

`writeReference` segue quatro passos:
1. grava `.yampi-sync/referencia-pendente.json`, com os hashes dos dois estados;
2. remove e grava só os originais que mudam;
3. grava o manifesto;
4. remove a marcação.

Ao ler uma pasta com a marcação, cada original pode estar em qualquer um dos dois estados. A pasta é aceita, com o aviso de que a atualização parou no meio, e a próxima atualização termina o trabalho. Sem a marcação, um original diferente do manifesto continua recusado. O manifesto mantém a versão que a pasta tinha (as ferramentas exportadas antes da versão 3 aceitam só 1 e 2; para elas, sem os dados de quebra de linha), a ferramenta, o tema, os caminhos ignorados e a prévia da exportação, e registra `reference`: quando, por que (`update` ou `send`) e com qual versão da extensão. As ferramentas locais (`npm run dev`, `npm run pack`) leem a referência nova normalmente; durante uma atualização interrompida, recusam a pasta até a extensão terminar.

Depois de um envio, se a escrita na pasta já estiver liberada, a referência da pasta recebe o que foi conferido na loja (a mesma referência que avança no navegador), com o horário da captura mantido. Uma versão `envio` guarda os textos.

## Versões conhecidas do projeto

Desde a 0.9.0, a comparação usa as versões que o próprio projeto já teve, por caminho, quando a referência da pasta é mais antiga que elas. São três fontes, todas lidas como dado e nunca como instrução:

- `.yampi-sync/versoes-conhecidas.json`, gravado por `npm run versoes:conhecidas` (`local-runtime/known.mjs`), com o SHA-256 e o texto de cada versão que o Git teve de cada texto de `tema/`. A extensão não lê o Git.
- os recibos de envio em `.yampi-sync/recibos/`;
- os registros de envio desta instalação, só itens conferidos.

Uma lista ou um recibo ilegível, alterado (texto que não confere com o hash) ou de outra loja fica de fora, com aviso.

Para um arquivo que mudou na loja desde a referência:

| A loja tem | Referência usada | Origem mostrada |
|---|---|---|
| um texto igual a uma versão conhecida (também com os caminhos de imagem desfeitos) | o texto da loja: a mudança é nossa | "A loja tem a versão enviada em DD/MM (sem mudança de outra pessoa)" |
| um texto diferente de todas, havendo versões com texto | a versão conhecida mais próxima do texto da loja | "A loja mudou depois do último envio conhecido: provável mudança de outra pessoa" |
| um texto diferente de todas, sem texto conhecido | a referência da pasta | a mesma frase acima |
| um texto, sem nenhuma versão conhecida desse caminho | a referência da pasta | nada: a extensão não sabe |

Isso vale na atualização e na revisão do envio (exceto na restauração, que só compara o registro do envio). Um arquivo criado pelo projeto e enviado antes, ausente da referência, fica `mine`, e não conflito do arquivo inteiro.

## Recibo de envio

Ao fim de um envio com itens conferidos, inclusive a partir de ZIP, **Baixar recibo do envio** gera `{format: 'zirtuno-sync-recibo', version: 1, context, sentAt, journalId, files: {caminho: {sha256, text}}}`. Ele contém só os textos conferidos, como ficaram na loja. Também se baixa pelo menu, a partir do histórico. Com a escrita na pasta liberada, o registro do envio na pasta também grava `.yampi-sync/recibos/recibo-<registro>.json`. Um recibo é uma versão conhecida do projeto, com a data do envio.

## Decisão por trecho e junção de um arquivo

Num conflito, `mergeTexts` separa os trechos que os dois lados mudaram. Cada trecho tem uma identidade calculada do seu conteúdo (os dois lados), e a escolha — `mine`, `theirs`, `both` ou `marks` — fica guardada por arquivo e por trecho. Numa nova leitura da loja, a escolha vale enquanto o trecho for o mesmo; um trecho que mudou volta a pedir decisão. Trecho sem escolha vai marcado.

**Juntar com a loja**, na revisão do envio, vale só para o arquivo em conflito:
1. a junção usa a referência do arquivo (com as versões conhecidas) e as escolhas por trecho;
2. o texto da pasta precisa estar como na comparação, e a pasta inteira vira a versão `antes-de-juntar`;
3. o resultado vai para `tema/`, com os caminhos de imagem do projeto;
4. a referência daquele caminho passa a ser o texto da loja usado, na pasta e no navegador;
5. a comparação é refeita.

O arquivo fica `update`, ou bloqueado se ainda tiver marcações. Nada mais é lido para decisão nem alterado. O envio continua relendo antes de gravar: se a loja mudou desde a junção, ele para, e a junção é refeita na próxima comparação.

## Caminhos de imagem na atualização

A atualização compara a pasta como o envio a deixa na loja: imagens novas movidas para `assets/images`, referências reescritas. Uma diferença só nesses caminhos é `same`. O texto da loja (e a junção) entra na pasta com os caminhos do projeto, desfazendo a mesma troca, para a prévia local continuar achando as imagens.

## Versões

Ficam na pasta do projeto, em `.yampi-sync/versoes/`, e vão com ela. Cada texto é guardado uma vez, com o nome do seu SHA-256 (`objetos/ab/<hash>`). Uma versão é um registro `<id>.json` com caminho, hash e tamanho de cada texto e o hash da lista inteira. Imagens nunca entram.

- **Automáticas.** `referencia`, `antes-de-atualizar` e `loja` a cada atualização; `antes-de-restaurar` antes de trazer arquivos de uma versão; `envio` depois de um envio registrado na pasta. Uma automática igual à última da mesma origem (`pasta` ou `loja`) não se repete.
- **Com nome.** Uma versão que o usuário nomeia (`manual`) é sempre guardada.
- Os textos são gravados antes do registro, então um registro nunca aponta para um texto ausente. Ao ler, cada texto é conferido pelo hash; um texto alterado ou ausente impede usar a versão.
- Registros ilegíveis ou de outra loja são ignorados e contados, nunca mostrados como histórico.
- **Trazer de uma versão.** O que o usuário comparou precisa continuar igual na pasta. A pasta inteira vira a versão `antes-de-restaurar`, e só então os arquivos escolhidos são gravados em `tema/`. Um arquivo apagado desde então é recriado, com suas pastas dentro de `tema/`. Nada é apagado. O que foi trazido entra no próximo envio como qualquer mudança da pasta, com comparação e backup.

## Imagens

A Yampi guarda imagens só direto em `assets/images`. Uma imagem nova em outra pasta, ou com nome que a Yampi trocaria, recebe um caminho lá: o próprio nome normalizado, ou as pastas unidas por `-` quando esse nome já pertence a outra imagem. Imagens que a loja já tem nunca mudam de lugar.

Toda referência literal ao caminho completo antigo (`images/hero/a.jpg`, inclusive em `../images/hero/a.jpg`) passa a apontar para o novo, em todos os textos do projeto, de forma determinística: comparar de novo dá o mesmo resultado. Um texto que ainda aponta para a pasta antiga depois disso — caminho montado em tempo de execução, ou relativo a `images/` — fica bloqueado, com o motivo. O projeto local não muda: a prévia continua usando as subpastas.

Desde a 0.8.0, imagens novas só entram no envio quando o usuário liga **Enviar imagens novas** na revisão, depois de um aviso: uma imagem enviada fica na loja, e a extensão não a substitui nem apaga. A opção começa desligada e volta a desligar a cada comparação. Desligada, a imagem fica `new-local`, com o motivo, e um texto que a usa fica bloqueado até a opção ser ligada. As referências continuam ajustadas do mesmo jeito, ligada ou não.

## Envio

1. Somente linhas `update`, `create` e `upload` da comparação confirmada, sem duplicatas e com os arquivos acoplados juntos. Texto novo que a Yampi não permite criar bloqueia todo o envio.
2. Confirmação explícita, com o nome da loja à vista.
3. Os textos existentes selecionados são relidos na loja (pelo servidor da Yampi, ou pelo editor recarregado quando o servidor não responde) e precisam estar como na comparação, e os caminhos novos precisam continuar livres. Qualquer diferença interrompe antes de gravar.
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

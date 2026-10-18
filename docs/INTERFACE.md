# Interface e identidade

## Nomes aprovados

O repositório principal continua **JonathanDelmonte/yampi-virtual-store-code-extractor-synchronizer**, assim como a pasta de desenvolvimento existente. O pacote npm usa **zirtuno-sync-yampi**, nome trazido do repositório **ZIRTUNO/zirtuno-sync-yampi** na integração de 15/10/2026.

Nome de exibição no Chrome e no painel: **Zirtuno Sync Yampi**. Autoria: **Zirtuno**. Descrição: **Edição local e sincronização do código da sua loja Yampi.**

Zirtuno identifica o desenvolvedor da ferramenta; Sync descreve a cópia do código para edição local e a sincronização dos textos escolhidos; Yampi identifica a plataforma compatível. O nome cabe no cabeçalho da extensão. Os identificadores internos de arquivos, backups e histórico são preservados para aceitar exportações anteriores.

A versão 0.3.3 usa a logo Y/código fornecida pelo proprietário, redimensionada com proporções e transparência preservadas. A pequena assinatura Zirtuno continua no cabeçalho. O Chrome controla a composição e o espaço entre descrição e ID na sua página de extensões; a descrição foi reduzida para uma frase curta, sem HTML ou artifícios de quebra de linha.

Na 0.3.4, a assinatura de 18 px usa uma imagem local de 72×72 px. O original autorizado permanece em `assets/zirtuno-logo-source.png`, fora do instalador. O painel mostra o progresso dos recursos visuais e da preparação do ZIP; a compactação em segundo plano mantém a interação disponível, inclusive o cancelamento.

## Direção aplicada na 0.3.2

Uma ferramenta de trabalho compacta, com fundo quase branco, texto escuro e azul petróleo nas ações. A paleta deriva do ciano da Zirtuno, com saturação reduzida para leitura confortável. A logo original autorizada aparece em 18 px, na mesma linha de **Desenvolvido por Zirtuno**; o conjunto abre `https://www.instagram.com/zirtuno/` por clique. Não carrega fontes ou imagens remotas. A loja permanece no cabeçalho durante toda a operação.

| Antes | Depois | Motivo |
| --- | --- | --- |
| Botões e campos rígidos | Bordas de 8–12 px, hover suave e pressão curta | Tornar os controles mais convidativos |
| Ações somente em grafite | Azul petróleo e fundos suaves de ciano/ardósia | Dar destaque à ação sem cores intensas |
| Identidade apenas em texto | Ícone de código e pequena assinatura Zirtuno | Identificar a ferramenta e sua autoria |
| Ícone genérico com aviso abreviado | Símbolo de código e tooltip com o nome do editor | Explicar onde usar a extensão |
| Clique fora do editor sem orientação | Painel com botão para abrir o editor na mesma aba | Mostrar o próximo passo explicitamente |
| Cartões repetidos para cada área | Seções abertas e divisórias finas | Dar prioridade ao conteúdo |
| Abas em uma cápsula | Navegação com sublinhado | Identificar a operação ativa |
| Selos coloridos na tabela | Resultado em texto, com cor complementar | Evitar depender de cor ou de decoração |
| Instruções longas sempre abertas | Ajuda expansível perto da ação | Expor detalhes quando necessários |
| Botões sem transição | Resposta de clique e hover curta | Confirmar a interação sem atraso |
| Rolagem animada em toda comparação | Rolagem imediata por teclado ou com movimento reduzido | Respeitar a forma de navegação |

## Envio em poucos passos na 0.5.0

O envio cabe em três ações: escolher a pasta, conferir o resumo, confirmar.

| Antes | Depois | Motivo |
| --- | --- | --- |
| Tabela de arquivos como tela principal | Quatro números (alterados, novos, imagens, iguais) e a tabela recolhida em **Ver todos os arquivos** | Mostrar o resultado, não o inventório |
| Avisos técnicos misturados | **Precisa da sua atenção**: só o que exige decisão ou ajuste, com o motivo e a ação ao lado | Nada a fazer quando nada aparece |
| Criar arquivos e enviar imagens à mão na Yampi | A extensão faz pelos controles do editor; o resumo informa quantos | Tirar etapas do usuário |
| Imagem em subpasta bloqueada | Aviso de para onde cada imagem vai e de que as referências são ajustadas | Explicar a única mudança de caminho |
| Digitar o nome da loja | Botão **Enviar N itens para Loja** e uma confirmação com o nome à vista | A identidade já é conferida pela extensão; a confirmação evita clique acidental |
| Mensagem de sucesso | Tela final com o que foi feito, os próximos passos na Yampi e **Desfazer este envio** | Levar até Ver prévia e Publicar |

O botão de envio sempre diz o que fará e, desabilitado, explica o motivo no título. Conflitos oferecem **Ver versões** e **Usar a versão do projeto**, com confirmação.

## Um passo por vez na 0.6.0

O painel deixou de ser uma página com todas as seções. Cada tela responde a uma pergunta e tem uma ação principal, sempre no mesmo lugar, na barra de baixo.

| Antes | Depois | Motivo |
| --- | --- | --- |
| Todas as seções numa página longa | Uma tela por etapa: início, baixar, escolher a pasta, revisar, andamento e resultado | Mostrar só o que vale para o passo atual |
| Status técnico ("Comparação concluída") | Título que diz o estado ("3 alterações prontas", "Envio concluído") e uma linha de detalhe | Ler o estado num relance |
| Vários botões com o mesmo peso | Uma ação principal na barra de baixo; as secundárias como links | Achar o próximo passo sem procurar |
| Histórico, backups e restauração na tela | No menu do topo | Tirar o que é raro do caminho comum |
| Progresso em uma linha de texto | Porcentagem, barra, item atual, tempo restante, etapas e registro do que foi conferido | Saber quanto falta e o que já está na loja |
| Conflito em três blocos de texto | Linhas alteradas, com projeto, original e loja em abas, e a escolha no mesmo lugar | Decidir vendo só a diferença |
| Fontes do sistema | Atkinson Hyperlegible Next e Mono (SIL OFL 1.1), no pacote | Caminhos e números legíveis; algarismos de largura fixa nas contagens |

### Material

O vidro fica só na camada de controle que flutua sobre o conteúdo: a barra do topo e a barra de ação. O conteúdo usa superfícies opacas, e não há vidro sobre vidro. No Chrome, as barras refratam o que passa por baixo, com um filtro SVG de deslocamento gerado para o tamanho de cada barra; a sombra cresce quando há conteúdo passando por baixo. Quando o sistema pede transparência reduzida (no Windows, **Efeitos de transparência** desligado), as barras ficam foscas e sem refração.

Uma cor de destaque, o ciano da Zirtuno, marca só a ação principal, o progresso e a etapa em andamento. Sem gradientes decorativos, brilhos, manchas de cor ou ícones em quadrados coloridos: a hierarquia vem do tamanho do título, do espaço e da posição da ação.

Referências: as diretrizes de Liquid Glass da Apple (vidro na camada de navegação e controles, tinta só na ação principal), ferramentas de trabalho com cromo discreto e um só destaque, e mostradores de instrumento para os números do andamento.

## Revisão de navegação em 18/10/2026

Mantém a paleta clara/escura, as fontes Atkinson e o desenho dos botões da 0.6.0. A revisão substitui a tela inicial e a ação fixa no rodapé por navegação persistente e ações junto do conteúdo. A execução em segundo plano, a comparação, a confirmação, o backup e a recuperação continuam com o mesmo contrato.

| Antes | Depois | Motivo |
| --- | --- | --- |
| Tela inicial com duas escolhas | Abas **Baixar arquivos** e **Importar projeto**, com abertura direta no download | Reduzir um clique e manter o contexto visível |
| Ponto próximo do nome, com possibilidade de quebra de linha | Ícone de conexão, espaço de 12 px e textos em uma linha; degradê e reticências no excesso, com tooltip completo | Dar espaço ao texto e manter o cabeçalho estável |
| Ação na barra fixa inferior | Ação na seção de download, escolha, revisão, andamento ou resultado | Aproximar o botão do conteúdo a que ele se refere |
| ZIP escondido num acordeão igual aos tutoriais | Bloco **Importar por ZIP**, sempre visível, com botão direto, nome do arquivo e instrução de `npm run pack` | Apresentar a alternativa como uma ação |
| Recuperação repetida abaixo das duas abas | Histórico, backups e restauração somente no menu **⋯** | Evitar duplicação nas telas de trabalho |
| Ajuda resumida e progresso recolhido | Tutoriais próximos das ações; etapas e registro inicialmente abertos | Recuperar a informação sem voltar à aparência antiga |
| Assinatura e informações no rodapé da página | Somente dentro do menu **⋯** | Deixar as telas de trabalho mais limpas |
| Lista nativa do histórico, vazia ou sem estilo | Seletor próprio com data, estado, seleção visível e teclado; desabilitado sem envios | Evitar o popup do navegador e identificar o backup escolhido |

Os rótulos distinguem as etapas: **Baixar arquivos** copia da loja para o computador; **Importar projeto** lê a pasta ou o ZIP editado e prepara a comparação; **Enviar N itens para Loja** fica reservado à confirmação da gravação.

O menu **⋯** abre **Histórico e backups**. Os controles de recuperação, a assinatura e as informações ficam somente dentro dele. O seletor do histórico mostra apenas os registros da loja atual; setas, Home, End e Enter permitem escolher um envio. Escape fecha primeiro a lista e depois o menu; Tab sai da lista e clicar fora a recolhe. Fechar o menu devolve o foco ao botão **⋯** e preserva a seleção usada para baixar ou restaurar.

As abas aceitam mouse, Tab, setas, Home e End. As ações continuam bloqueadas durante uma operação, e trocar de aba preserva o projeto e a comparação. A orientação fora do editor mantém seu próprio fluxo. Não foi acrescentada exportação direta para uma pasta: a cópia do tema continua em ZIP, e escolher uma pasta serve para ler o projeto editado.

## Movimento e acesso

- Troca de tela: 240 ms, com opacidade e deslocamento de 6 px, em curva de desaceleração. Folhas sobem em 280 ms; a barra de progresso anda em 450 ms; botões respondem à pressão em 120 ms.
- Hover é restrito a dispositivos com ponteiro preciso.
- A troca por teclado é imediata; o foco tem contorno visível. Movimento reduzido desativa deslocamentos e transições. Cada mudança de tela é anunciada para leitores de tela.
- Textos, nomes de loja e caminhos podem quebrar linha. A tabela e o código têm rolagem própria quando necessário.
- Confirmação de leitura, nome da loja no envio, comparação de versões, backups e diagnóstico de erros continuam presentes. Abrir o painel não inicia a cópia.
- Tutoriais e textos explicativos são preservados. Botões desabilitados explicam o requisito pendente no hover.
- O painel fora do editor serve somente para orientação. Seu botão navega para o endereço fixo do editor mediante clique; não pode se autenticar como painel de código. Fechamentos atrasados da orientação não desativam o novo painel.

## Distribuição e privacidade

O release marcado como mais recente oferece `zirtuno-sync-yampi.zip` e seu SHA-256. O README destaca o link direto `releases/latest/download/zirtuno-sync-yampi.zip`, que permanece igual entre versões. Releases anteriores preservam seus nomes e arquivos históricos. O histórico Git preserva alterações de código para auditoria e correções. A geração local usa `.cache/package/` para ZIPs e hashes, e atualiza a pasta fixa `releases/zirtuno-sync-yampi/`, pronta para carregar sem compactação no Chrome. Essa pasta deve permanecer no computador enquanto estiver instalada. Nenhum tema, exportação, backup ou dado de loja deve entrar no repositório ou no pacote da extensão. Exemplos e testes são fictícios.

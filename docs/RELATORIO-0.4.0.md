# Relatório da versão 0.4.0

Resposta à análise da exportação 0.3.4 (documento "Prompt: análise da exportação 0.3.4 e próximas correções da extensão"). Todos os testes usam lojas, temas, imagens e dados inteiramente fictícios. Nada foi gravado, enviado ou publicado na Yampi, e nenhum conteúdo da loja de referência foi copiado para este repositório.

Legenda: **[testado]** coberto por teste automatizado com fixture fictício no formato descrito pela análise; **[inferido]** comportamento da plataforma deduzido, ainda sem conferência numa loja real; **[pendente]** não implementado nesta versão.

## Resultado principal

Uma exportação nova, gerada pela própria captura da extensão a partir de uma vitrine fictícia no formato real, passa em `npm ci`, `npm run check:integrity` e `npm run check` sem edição manual. Em Chromium, home, categoria, produto, página institucional e promoção abrem com todas as seções visíveis, fontes `loaded`, ícones de `$assets` e imagens capturadas, sem erros OTS. Quando algo falta (seção, rota da API, fonte, imagem), a prévia diz exatamente o quê. **[testado]**

## Itens da análise

### P0

| Item | Situação | Onde |
|---|---|---|
| P0-1 `check` falha sem `merchantData.company` | Objetos públicos completos; `company` mantém a forma com valores `"redacted"`. Objeto ausente na vitrine gera erro com o arquivo (`footer.twig`) e aparece em `contract.keys`. **[testado]** | `src/core/preview.ts` |
| P0-2 Contrato de seções | Adaptador único `platformContext` (lista crua → `header`, `footer`, `mainSections` por `order`), usado por captura, `check`, `dev` e testes. Seções renderizadas = seções visíveis com `position === 1` em cada página. **[testado]** | `local-runtime/contract.mjs`, `dev.mjs` |
| P0-3 Aliases `main_*` | Resolução por regra: página, sem `main_`, `global`, pasta `content` para institucionais, nome único. Alias sem arquivo é erro com alias e página, também listado em `report.json > contract`. **[testado]** | `contract.mjs` |
| P0-4 Lista fixa de chaves | Lista de bloqueio (segredos, rastreamento, dados de cliente), limites de tamanho/profundidade, e-mail/CPF/CNPJ trocados por `"redacted"`. Captura bruta imutável em `preview/raw/`; URLs reescritas só em tempo de execução. Varredura estática das chaves usadas pelo código, com motivo da ausência. **[testado]** | `preview.ts`, `contract.mjs` |
| P0-5 Parâmetros da seção principal | `window.data.config` mesclado à entrada de `themeConfig.sections`, com precedência de `data.config`. **[testado]**; a precedência na plataforma é **[inferido]**. | `contract.mjs` |

### P1

| Item | Situação |
|---|---|
| P1-1 `@import` Sass como URL | Nenhuma URL é extraída do código do tema. URLs vêm do HTML, do CSS servido (resolvidas contra a URL da folha) e dos dados. Zero requisições `.scss` no teste. **[testado]** |
| P1-2 Fontes | Só faces `latin`/`latin-ext` (comentário de subconjunto ou `unicode-range`), preferindo WOFF2; `font_link` aponta para a folha capturada; face não capturada é removida. **[testado]** em Chromium (`document.fonts` `loaded`, sem OTS). |
| P1-3 Ícones de `$assets` | Base descoberta no CSS servido a partir das chamadas `image()` do Sass (`platform.assetsBase`); ícones com prioridade alta; rota local `/__platform/assets/` com `tema/assets` como alternativa. **[testado]** |
| P1-4 Coleções, banners, grade | GETs anônimos derivados das seções visíveis (`resource.ids`, `*_banner.ids`, `slugs`), gravados e reproduzidos com filtro por id/slug/limit. **[testado]**; endpoints `catalog/collections`, `catalog/banners` e `catalog/products/<slug>` seguem o projeto de referência; demais rotas e formatos **[inferido]**. |
| P1-5 Imagens duplicadas | Uma variante por imagem subjacente (thumbor e sufixos `-large/-small`), preferindo a exibida no HTML; mapa de aliases; bytes por categoria no relatório. **[testado]**; o formato exato das URLs do thumbor da Yampi é **[inferido]**. |
| P1-6 Escolha das páginas | Uma página de cada tipo (home, categoria, produto, institucional, promoção, busca) antes do restante; tipos ausentes listados. **[testado]** |
| P1-7 Rascunho ou publicado | `npm run check` compara o Sass compilado com o CSS publicado capturado (`published-verified-by-css` ou lista de divergências). **[testado]**; a equivalência com o minificador real é **[inferido]** a partir das diferenças descritas na análise. Capturar pela prévia do editor (rascunho) **[pendente]**. |
| P1-8 CSS publicado sem uso | Usado na paridade de P1-7. **[testado]** |

### P2

| Item | Situação |
|---|---|
| P2-1 Twing × Twig PHP | Nulos como no Twig PHP (`raw`, filtros de texto, `format`, `abs`, `date`), booleanos em concatenação e soma com texto numérico; erros claros para `merge`/`filter`/`sort` em nulo. Suíte de equivalência. **[testado]** |
| P2-2 Validação de markup | HTML normalizado com parse5 antes do Vue; o que o navegador corrige vira aviso com o arquivo provável; 422 só para erros reais. **[testado]** |
| P2-3 API simulada | Respostas gravadas; rota não gravada (por exemplo `catalog/products/<id>/flags`, `placeholders/*`, `count`) gera erro explícito no diagnóstico; derivações documentadas apenas para `filters` e `products` da amostra. Escritas negadas. **[testado]** |
| P2-4 `local.data.json` | Somente sobreposições, escopo `global`/`pages.<tipo>`/`pages.<captura>`, seções por `alias` ou `alias@ordem`, JSON Merge Patch. **[testado]** |
| P2-5 Classes do `body` | Preservadas como o template monta. **[testado]** |
| P2-6 Ordem do CSS mobile | Cada folha no seu `<link>` com o `media` do template; combinado legado na ordem página-mobile → global-mobile. **[testado]** |
| P2-7 Splide, `font_weight`, adaptador | CSS da biblioteca Splide desativado por padrão (`splideCss` opcional; **[inferido]**); `font_weight` com thin…black; Twing 7.3.1 fixado, exportações Locutus e trechos adaptados verificados na carga. **[testado]** |
| P2-8 Componentes | Só os de `components.twig` são registrados; avisos para `.vue` fora da lista e item sem arquivo, na prévia e no retorno. **[testado]**. O tema indica que `components.twig` é gerado pela Yampi; a regeneração ao criar componentes é **[inferido]**. |
| P2-9 Prontidão | `__yampiLocalReady` falso quando falta seção; `__yampiLocalState` e a barra da prévia contam seções, placeholders, fontes com erro e rotas não capturadas. **[testado]** em Chromium. |
| P2-10 `logs/` | Registrado em `manifest.skipped`; não é exportado nem enviado. Leitura somente leitura dos logs **[pendente]**. |

### P3

| Item | Situação |
|---|---|
| P3-1 Dependências de arquivos novos | Grafo de `@import/@use/@forward`, `include/embed/extends/import/from`, `get_section_file`, `assets_url`/`asset()`, imports `.vue`, componentes por tag e `components.twig`. Bloqueio com o nome dos dois arquivos; arquivos alterados que se usam só vão juntos; dependência que não pode ser enviada bloqueia quem a usa. **[testado]** |
| P3-2 `assets_url` | Aviso na prévia de que o caminho local não garante o de produção. Verificação na plataforma **[pendente]**. |
| P3-3 Conflitos remotos | Comparação de três vias, preflight, backup antes de gravar, releitura e conferência após reload continuam. Identificador remoto e versão por arquivo exigem o endpoint do editor real **[pendente]**. |
| P3-4 Espaço em branco | `.editorconfig` e `.vscode/settings.json` preservam os bytes; diferenças só de espaço separadas, sem seleção inicial e descartáveis. **[testado]** |
| P3-5 Integridade do retorno | `check:integrity -- --return-zip` confere entradas e hashes; `-- --original` afirma zero alterações; adicionados separados dos modificados. **[testado]** |

### Organização e atualização

- Manifesto versão 3 com `tool`, `theme` (identificado pela vitrine publicada; estado `unknown`), `eol`/`finalNewline` por arquivo, `skipped` e vínculo com `preview/manifest.json`. Versões 1 e 2 continuam legíveis. **[testado]**
- `.gitignore` comentado; README do projeto com retorno, sobreposições, atualização e versionamento privado. **[testado]**
- Atualizador (seção 8): `--preview` troca `preview/` por nova exportação da mesma loja, migra `local.data.json` antigo para o backup, mostra o plano antes de aplicar e `--rollback` desfaz, recusando arquivos alterados depois. **[testado]**
- Fechar as abas abertas pela extensão no editor e ler pelo endpoint do editor **[pendente]**: exigem validação no editor real.

## Arquivos alterados

| Área | Arquivos |
|---|---|
| Contrato e retorno compartilhados | `local-runtime/contract.mjs`, `dependencies.mjs` (e declarações `.d.mts`) |
| Runtime local | `engine.mjs`, `dev.mjs`, `preview.mjs`, `platform.mjs`, `platform-browser.mjs`, `twig.mjs`, `parity.mjs`, `integrity.mjs`, `pack.mjs`, `package.json`/lock (parse5) |
| Captura e formato | `src/core/preview.ts`, `src/browser/preview-capture.ts`, `src/browser/bridge.ts` |
| Projeto e manifesto | `src/core/local-kit.ts`, `archive.ts`, `model.ts` |
| Retorno | `src/core/planner.ts`, `workflow.ts`, `src/panel.ts`, `extension/panel.html`, `panel.css` |
| Atualização | `scripts/update-project.mjs`, `runtime-versions.json` |
| Testes | `tests/contract.test.ts`, `rocket-like.test.ts`, `fixtures/rocket-like.ts`, `fixtures/dom.ts`, demais suítes adaptadas, `scripts/preview-e2e.mjs`, `scripts/e2e.mjs` |

## Nova exportação

1. Recarregue a extensão 0.4.0 na mesma pasta instalada e recarregue o editor sem rascunhos pendentes.
2. Exporte com **Incluir contexto visual da vitrine publicada** marcado. Autorize as origens listadas: vitrine, imagens, fontes e `api.dooki.com.br` (leituras públicas de catálogo, sem credenciais).
3. Extraia em uma pasta nova e execute `npm ci`, `npm run check:integrity`, `npm run check` e `npm run dev`.
4. Confira `preview/report.json > contract` e `.cache/yampi-check.json`: páginas capturadas, seções, chaves ausentes, paridade de CSS.

## Projeto existente (por exemplo, ferramentas 0.2.4)

```powershell
node scripts/update-project.mjs "C:/projeto" --preview "C:/nova-exportacao.zip"
node scripts/update-project.mjs "C:/projeto" --preview "C:/nova-exportacao.zip" --apply
```

Revise o plano (ferramentas, `package.json`, lockfile, `preview/`, migração de `local.data.json`) antes do `--apply`. Para desfazer: `--rollback .yampi-sync/updates/<data> --apply`. Dependências próprias, como uma `devDependency` adicionada ao projeto, são mantidas no lockfile. `tema/`, originais, manifesto e `local.config.json` não mudam.

## Limitações restantes

- A captura 0.4.0 não foi executada numa vitrine real nesta tarefa; os resultados acima são de fixtures fictícios que reproduzem o formato descrito pela análise.
- Rotas da API pública além de coleções, banners e produtos por slug, e o formato de resposta delas, não são conhecidos: na prévia, falham explicitamente.
- O minificador da plataforma pode ter diferenças além das normalizadas; nesse caso a paridade lista as regras divergentes.
- `assets_url`, regeneração de `components.twig`, estado rascunho/publicado e gravações/restaurações reais continuam sem validação.

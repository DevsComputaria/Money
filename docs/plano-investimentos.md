# Plano: central de investimentos

Plano de execução da seção **Investimentos** do Profit. Cada fase termina com algo usável na tela e é entregue, revisada
e só então a próxima começa. Marque `[x]` conforme for concluindo.

## Decisões já tomadas

- **Dinheiro da empresa aparece separado**, como "da empresa" (mesma regra do dashboard: contas/cartões `empresarial`).
  Não entra no patrimônio pessoal, nas projeções nem nas recomendações; aparece num bloco próprio.
- **Corretora:** ainda não tem. Sugestão: **Nu Invest** (dentro do app do Nubank, já conectado pela Pluggy). Ver
  [Corretora](#corretora). Enquanto não houver investimentos, a página continua mostrando o rendimento automático do
  Mercado Pago (empresa).
- **IA com limite de gasto:** o usuário cadastra a chave da Anthropic; o app tem teto mensal próprio, além do limite do
  Console. Ver [Limite de gasto da IA](#limite-de-gasto-da-ia).
- **Sem B3 direta:** a API da Área do Investidor é só para pessoa jurídica, com avaliação de segurança e piso de
  R$ 500/mês. Posições vêm da Pluggy (`/investments`, Open Finance).
- **Sem NewsAPI:** o plano grátis proíbe produção (inclusive uso interno) e atrasa 24h. Notícias vêm do **RSS do Google
  News pt-BR**.
- **Custo alvo das fases 0–3: R$ 0/mês.** Fase 4: só o consumo da IA, dentro do teto.

## Fontes de dados

| Dado | Fonte | Chave | Observação |
|---|---|---|---|
| Selic, CDI, IPCA, dólar PTAX | Banco Central, SGS (`api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados`) | não | Séries: 432 (meta Selic), 12 (CDI diário), 433 (IPCA mensal), 1 (dólar venda) |
| Expectativas (Focus) | BCB Olinda (`olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/`) | não | Selic, IPCA, câmbio; atualiza às segundas |
| Tesouro Direto (preços/taxas) | Tesouro Transparente (CSV de dados abertos) | não | Atualiza 1x/dia |
| Ações, FIIs, ETFs | brapi.dev, plano grátis | sim (`BRAPI_TOKEN`) | 15 mil req/mês, 1 ticker por chamada, atraso até 30 min |
| Posições e movimentos de investimentos | Pluggy `/investments` (+ transações de investimento) | já existe | Pelo Open Finance, `amountProfit`/`lastMonthRate`/`annualRate` vêm nulos: rendimento é calculado pelo app |
| Notícias | Google News RSS (`news.google.com/rss/search?q=...&hl=pt-BR&gl=BR&ceid=BR:pt-419`) | não | Busca por tema e por ticker |
| Classificação de notícias e sinais | API da Anthropic, modelo pequeno (Haiku) | sim (`ANTHROPIC_API_KEY`) | Só na fase 4, com teto mensal |

Antes de usar cada fonte, conferir endpoint e formato com uma chamada real; anotar aqui qualquer diferença.

## Arquitetura

Mesmo padrão do `sync-pluggy`:

- **Edge functions** do Supabase buscam fora; chaves ficam como secrets, nunca no front.
- **pg_cron** agenda as buscas; resultados vão para tabelas próprias com RLS por `user_id` (dados de mercado são
  públicos: tabela sem `user_id`, leitura para `authenticated`, escrita só pela service role).
- **O app só lê do banco.** Rápido, histórico guardado, limites das APIs preservados.
- Telas novas seguem o visual atual (cards `solido`, gráficos recharts com as variáveis `--grafico-*`, `formatarMoeda`).

## Fase 0: indicadores de mercado

Objetivo: ver Selic, CDI, IPCA e dólar na página, com histórico.

- [x] Migration `mercado` (`20261031000000_mercado.sql`): `indicadores (serie, dia, valor, gravado_em)`,
      `expectativas (indicador, ano, data_coleta, mediana)` e a função `ultimos_dias_indicadores()`
- [x] Edge function `mercado-sync`: busca SGS (desde o último dia gravado − 10; 1ª vez 5 anos) e Focus (Selic, IPCA,
      Câmbio, ano atual + 2); não repete em menos de 30 min; grava com a service role
- [x] pg_cron: `mercado-sync-diario` (23h UTC = 20h) e `mercado-sync-focus` (segunda 12h UTC, quando sai o Focus).
      Criados por SQL, fora da migration, porque levam a URL e a anon key do projeto:
      `select cron.schedule('mercado-sync-diario', '0 23 * * *', $$ select net.http_post(url := '<url>/functions/v1/mercado-sync', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <anon key>'), body := '{}'::jsonb, timeout_milliseconds := 120000) $$);`
- [x] `services/mercado.ts` + `FaixaIndicadores`: Selic meta, CDI, IPCA 12m e dólar, com variação em 30 dias e o Focus
      do fim do ano; o app pede atualização se os dados tiverem mais de 26h
- [x] `GraficoDolar`: dólar 12 meses com média de 200 dias úteis e quanto está acima/abaixo dela

Pronto quando: indicadores batem com o site do BCB no mesmo dia. ✅ 27/10/2026 (Selic 13,75%, CDI 13,65%, IPCA 12m 4,58%, dólar R$ 5,3346).

## Fase 1: carteira real

Objetivo: patrimônio pessoal de verdade, separado do da empresa.

- [x] Migration `investimentos`: `investimentos` (id pluggy ou manual, conta/instituição, tipo, subtipo, nome, emissor,
      taxa, indexador, vencimento, saldo bruto, saldo líquido, quantidade, `empresarial`, atualizado_em) e
      `investimentos_historico (investimento_id, dia, saldo_bruto, saldo_liquido)` para a evolução
- [x] `sync-pluggy`: nova etapa que lê `/investments` de cada item e grava posições + histórico do dia
      (a etapa não pode quebrar a sincronização das transações se falhar)
- [x] Cadastro manual (modal): ativo que a Pluggy não traz (dólar em espécie, cripto, ação comprada fora)
- [ ] Tabela `ativos_acompanhados (ticker)` e cotação via brapi no `mercado-sync` (só tickers da carteira + acompanhados,
      para caber no plano grátis)
      _Parcial: cota só os tickers da carteira; `ativos_acompanhados` ainda não existe._
- [ ] Página: card "Patrimônio pessoal" (total, por tipo, por instituição, evolução mensal) e bloco "Da empresa"
      (Mercado Pago, rendimento automático, como hoje)
      _Parcial: total, por tipo e bloco da empresa prontos; falta por instituição e evolução mensal (precisa de histórico)._
- [ ] Rendimento do mês por investimento = variação do saldo − aportes + resgates (Open Finance não informa rendimento)

Pronto quando: o total pessoal bate com a soma dos apps dos bancos/corretora.

## Fase 2: projeções

Objetivo: saber quanto dá para guardar e onde rende mais, com números líquidos. Só cálculo, sem IA.

- [x] `lib/projecoes.ts` (puro, testável): juros compostos com aporte mensal, IR regressivo (22,5% → 15%), IOF nos
      primeiros 30 dias, isenção de LCI/LCA, taxa de custódia do Tesouro
      _Sem IOF: a simulação é por mês e os prazos começam em 1 ano, então o IOF dos primeiros 30 dias nunca entra._
- [x] Taxas futuras pelo Focus (Selic/IPCA esperados por ano), não a taxa de hoje congelada
- [x] Simulador: aporte sugerido = média do **Resultado do mês** dos últimos 3 meses fechados (já calculado no
      dashboard); usuário pode ajustar
- [ ] Comparativo lado a lado: 100% CDI, Tesouro Selic, Tesouro IPCA+, LCI/LCA, poupança, em 1, 2 e 5 anos
      _Parcial: CDB 100% CDI, Tesouro Selic, LCI/LCA e poupança; falta Tesouro IPCA+._
- [x] Metas: reserva de emergência = 6 × gasto médio mensal pessoal (configurável), com barra de progresso; outras
      metas livres
- [ ] Testes de `lib/projecoes.ts` com valores conferidos na calculadora do Tesouro Direto
      _Parcial: conferido com contas fechadas (script de conferência fora do repositório), ainda não com a calculadora do Tesouro._

Pronto quando: a simulação do Tesouro Selic bate (±1%) com o simulador oficial do Tesouro.

## Fase 3: notícias

Objetivo: feed de notícias que mexem com investimentos, sem repetição.

- [x] Migration `noticias (id hash do link, titulo, fonte, link, publicada_em, temas text[], tickers text[])`
- [x] Edge function `noticias-sync`: RSS do Google News para temas fixos (dólar/câmbio, Copom/Selic, inflação,
      fiscal/arcabouço, eleição/política econômica) + um tema por ticker da carteira; dedupe por link e título parecido
- [x] pg_cron a cada 2h em dia útil, 1x/dia no fim de semana
      `noticias-sync-util` (`0 11-23/2 * * 1-5` UTC), `noticias-sync-fds` (`0 14 * * 0,6`) e, da fase 4,
      `radar-sync-diario` (`40 23 * * *` = 20h40, depois do mercado-sync). Mesmo formato de SQL da fase 0.
- [x] Página: card "Notícias" com filtro por tema; link abre a matéria original
- [x] Limpeza: apagar notícias com mais de 90 dias

Pronto quando: o feed mostra as manchetes do dia sem duplicadas.

## Fase 4: radar de oportunidades (IA)

Objetivo: transformar notícias + números em sinais com tese, risco e tamanho, e medir se acertam.

- [x] [Limite de gasto](#limite-de-gasto-da-ia) implementado **antes** de qualquer chamada à IA
- [x] Classificação: `noticias-sync` manda as manchetes novas em lote para o Haiku; volta tema, ativos afetados,
      direção provável, prazo, relevância (0–1). Notícia irrelevante não gera sinal
- [ ] Sinais quantitativos (sem IA): dólar vs média de 200 dias; dólar à vista vs câmbio do Focus; Selic esperada vs
      taxa do Tesouro Prefixado; IPCA+ real vs média histórica
      _Parcial: dólar vs MM200, dólar vs Focus, juro real e queda de juros esperada; falta taxa do Prefixado/IPCA+ (sem fonte ainda)._
- [x] Geração de sinal (IA, 1x/dia): junta notícias relevantes + sinais quantitativos + perfil (reserva, saldo livre)
      e devolve no máximo 3 cards: tese, cenário que o preço já embute, o que confirma, o que invalida, risco, prazo,
      **% máximo do saldo livre** sugerido
      _Feito com uma mudança: o perfil não vai para a IA; reserva, teto de 10% e perda em reais são aplicados no app._
- [x] Regras fixas por cima da IA (código, não prompt): sem reserva de emergência completa → só sinais de renda fixa
      pós-fixada; aposta tática nunca passa de 10% do patrimônio pessoal; todo card mostra a perda no cenário contrário
- [x] Diário de teses: tabela `teses (sinal, decisao entrei/passei, valor, preco_entrada, data, resultado)`; o app
      acompanha o preço e mostra a taxa de acerto dos sinais ao longo do tempo
- [x] Texto fixo nos cards: sinal informativo para uso pessoal, não é recomendação profissional

Pronto quando: há sinais diários dentro do teto de gasto e o diário de teses registra o resultado.

## Fase 5 (opcional): alertas

- [ ] Push no PWA: sinal com relevância alta, vencimento de investimento em 7 dias, meta alcançada
- [ ] Preferências de alerta na página Bancos/Configurações

## Limite de gasto da IA

Duas camadas, para nunca gastar mais do que o combinado:

1. **No Console da Anthropic (usuário faz):** criar a chave num workspace só do Profit e definir o *spend limit*
   mensal desse workspace. Se o app falhar, a Anthropic corta.
2. **No app (eu implemento):**
   - Secrets: `ANTHROPIC_API_KEY` e `IA_LIMITE_MENSAL_USD` (padrão **US$ 2**)
   - Tabela `ia_uso (mes, chamadas, tokens_entrada, tokens_saida, custo_usd)`; toda chamada soma o `usage` devolvido pela
     API com o preço por token do modelo (conferido na doc ao implementar e guardado numa constante)
   - Antes de chamar: se o custo do mês + estimativa da chamada passar do limite, não chama; o radar mostra "limite do
     mês atingido" e os sinais quantitativos (sem IA) continuam
   - `max_tokens` baixo em toda chamada; manchetes em lote; no máximo 1 geração de sinais por dia
   - Página mostra o gasto do mês ("US$ 0,43 de US$ 2,00")

## Corretora

Critério principal para o Profit: os investimentos aparecerem sozinhos pela Pluggy (Open Finance) e custo zero para
começar com pouco.

- **Sugestão: Nu Invest** (app do Nubank): você já tem conta e já está conectado pela Pluggy; sem corretagem em ações e
  FIIs; Tesouro Direto e CDBs no mesmo app. Começar com Tesouro Selic ou CDB 100% CDI com liquidez diária para a reserva.
- **Alternativas:** Inter (taxa zero em ações/FIIs, tudo num app) ou XP/Rico (mais produtos, plataforma mais completa).
- **Conferir na fase 1:** se os investimentos do Nu Invest chegam pelo `/investments` da Pluggy; se não chegarem,
  cadastro manual até resolver.
- Mesmo com corretagem zero existem custos: emolumentos da B3, custódia do Tesouro acima do limite de isenção, IR.

## Ordem de execução

1. Fase 0
2. Fase 1 (depende de ter a corretora aberta para validar; o resto da fase anda antes)
3. Fase 2
4. Fase 3
5. Fase 4 (só depois de o usuário cadastrar a chave e o limite no Console)
6. Fase 5, se fizer sentido

Ao fim de cada fase: `npx tsc --noEmit -p .`, prettier, prints no celular (360px) e no computador, e aviso do que mudou.
Nada é commitado sem pedido.

## Secrets que o usuário cadastra

| Secret | Fase | Onde pegar |
|---|---|---|
| `BRAPI_TOKEN` | 1 | brapi.dev → criar conta grátis → token |
| `ANTHROPIC_API_KEY` | 4 | console.anthropic.com → workspace "Profit" → API keys |
| `IA_LIMITE_MENSAL_USD` | 4 | valor escolhido (padrão 2) |

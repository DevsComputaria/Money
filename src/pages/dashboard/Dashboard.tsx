import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import Esqueleto, { EsqueletoLista } from '../../components/Esqueleto'
import GraficoGastosDiarios from '../../components/GraficoGastosDiarios'
import ListaLancamentos from '../../components/ListaLancamentos'
import SeletorMes from '../../components/SeletorMes'
import Sincronizar from '../../components/Sincronizar'
import { IconeLista, IconeSetaBaixo, IconeSetaCima } from '../../components/icones'
import { useAuth } from '../../hooks/useAuth'
import { useLancamentos } from '../../hooks/useLancamentos'
import { acertosPorPessoa, frasesDoSaldo, type AcertoPessoa } from '../../lib/acertos'
import { inicioDoMes, mesAnterior, paraMesISO } from '../../lib/datas'
import { datasDaFatura, statusDaFatura, type StatusFatura } from '../../lib/fatura'
import { formatarDiaMes, formatarMoeda, formatarNomeDoMes } from '../../lib/formatar'
import { gastoEmCentavos, gastosAcumuladosPorDia, gastosPorCategoria, receitaEmCentavos, variacaoPercentual } from '../../lib/resumos'
import { listarCartoes } from '../../services/cartoes'
import { listarCategorias } from '../../services/categorias'
import { buscarPerfil } from '../../services/perfis'
import {
  buscarSaldoAtual,
  listarComprasDasFaturas,
  listarLancamentosDeTerceiros,
  listarPagamentosDasFaturas,
  listarTransacoesDoMes,
} from '../../services/transacoes'
import type { Cartao, Categoria, Transacao } from '../../types/financas'

const QUANTAS_CATEGORIAS = 5
const QUANTOS_ULTIMOS = 5

const nomeDoStatus: Record<StatusFatura, string> = {
  aberta: 'Em aberto',
  fechada: 'Fechada',
  parcial: 'Paga em parte',
  paga: 'Paga',
}

/** Aba "Início" (a rota continua /dashboard) */
export default function Dashboard() {
  const { usuario } = useAuth()
  const { versao, editarLancamento } = useLancamentos()
  const [nome, setNome] = useState('')
  const [mes, setMes] = useState(() => inicioDoMes())

  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [anteriores, setAnteriores] = useState<Transacao[]>([])
  // Compras nas faturas que vencem no mês, para separar o que é da mãe
  const [comprasDasFaturas, setComprasDasFaturas] = useState<Transacao[]>([])
  const [pagamentosDasFaturas, setPagamentosDasFaturas] = useState<{ pagamento_cartao_id: string | null; valor: number }[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [saldo, setSaldo] = useState<number | null>(null)
  const [acertos, setAcertos] = useState<AcertoPessoa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!usuario) return
    setNome(usuario.user_metadata.nome ?? '')
    buscarPerfil(usuario.id)
      .then((perfil) => setNome(perfil.nome))
      .catch(() => {}) // sem perfil, fica o nome do cadastro
  }, [usuario])

  // Recarrega ao trocar de mês e sempre que um lançamento é salvo/excluído (versao)
  useEffect(() => {
    let ativo = true
    setCarregando(true)
    Promise.all([
      listarTransacoesDoMes(mes),
      listarTransacoesDoMes(mesAnterior(mes)),
      listarCategorias(),
      listarCartoes(),
      buscarSaldoAtual(),
      listarLancamentosDeTerceiros(),
      listarComprasDasFaturas(mes),
      listarPagamentosDasFaturas(mes),
    ])
      .then(([doMes, doAnterior, cats, crts, s, deTerceiros, dasFaturas, pagamentos]) => {
        if (!ativo) return
        setAcertos(acertosPorPessoa(deTerceiros))
        setTransacoes(doMes)
        setAnteriores(doAnterior)
        setComprasDasFaturas(dasFaturas)
        setPagamentosDasFaturas(pagamentos)
        setCategorias(cats)
        setCartoes(crts)
        setSaldo(s)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar seus lançamentos.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [mes, versao])

  // Somas em centavos para não acumular erro de arredondamento
  const totais = useMemo(() => {
    let receitas = 0
    let despesas = 0
    let noCredito = 0
    for (const t of transacoes) {
      receitas += receitaEmCentavos(t)
      const gasto = gastoEmCentavos(t)
      despesas += gasto
      if (t.forma === 'credito') noCredito += gasto
    }
    return { receitas: receitas / 100, despesas: despesas / 100, noCredito: noCredito / 100 }
  }, [transacoes])

  // Faturas que vencem no mês: quanto é da mãe e quanto sobra para você pagar
  const faturas = useMemo(() => {
    let total = 0
    let daMae = 0
    for (const t of comprasDasFaturas) {
      const centavos = Math.round(t.valor * 100)
      total += t.tipo === 'despesa' ? centavos : -centavos
      if (t.da_mae) daMae += centavos
    }
    return { total: total / 100, daMae: daMae / 100, seu: (total - daMae) / 100 }
  }, [comprasDasFaturas])
  // Da maior para a menor, como em "Principais categorias"
  const comprasDaMae = useMemo(
    () => comprasDasFaturas.filter((t) => t.da_mae).sort((a, b) => b.valor - a.valor),
    [comprasDasFaturas],
  )
  const cartaoPorId = useMemo(() => new Map(cartoes.map((c) => [c.id, c])), [cartoes])

  // Sua parte de cada fatura do mês: o total do cartão menos as compras da mãe, da maior para a menor
  const suasFaturas = useMemo(() => {
    const pago = new Map<string, number>()
    for (const p of pagamentosDasFaturas) {
      if (p.pagamento_cartao_id) pago.set(p.pagamento_cartao_id, (pago.get(p.pagamento_cartao_id) ?? 0) + Math.round(p.valor * 100))
    }
    return cartoes
      .map((cartao) => {
        let total = 0
        let daMae = 0
        for (const t of comprasDasFaturas) {
          if (t.cartao_id !== cartao.id) continue
          const centavos = Math.round(t.valor * 100)
          total += t.tipo === 'despesa' ? centavos : -centavos
          if (t.da_mae) daMae += centavos
        }
        const { fechamento, vencimento } = datasDaFatura(mes, cartao.dia_fechamento, cartao.dia_vencimento)
        // O status vale para a fatura inteira, com as compras da mãe
        const status = statusDaFatura(fechamento, pago.get(cartao.id) ?? 0, total)
        return { cartao, total, seu: (total - daMae) / 100, vencimento, status }
      })
      .filter((f) => f.total !== 0)
      .sort((a, b) => b.seu - a.seu)
  }, [cartoes, comprasDasFaturas, pagamentosDasFaturas, mes])

  const pontos = useMemo(() => gastosAcumuladosPorDia(transacoes, anteriores, mes), [transacoes, anteriores, mes])
  const porCategoria = useMemo(() => gastosPorCategoria(transacoes, anteriores), [transacoes, anteriores])
  const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias])

  const nomeMes = formatarNomeDoMes(mes)
  const nomeMesAnterior = formatarNomeDoMes(mesAnterior(mes))
  const linkDoMes = `/lancamentos?mes=${paraMesISO(mes)}`
  const primeiroNome = nome.split(' ')[0]
  // Na primeira carga mostra o esqueleto; nas seguintes mantém o conteúdo meio apagado
  const primeiraCarga = carregando && saldo === null
  const recarregando = carregando ? 'opacity-60 transition' : 'transition'
  const semGastos = pontos.every((p) => !p.atual && !p.anterior)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Olá{primeiroNome && `, ${primeiroNome}`}</h1>
        <SeletorMes mes={mes} aoMudar={setMes} />
      </div>

      <div className="mt-4 empty:hidden">
        <Sincronizar compacto />
      </div>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      <div className={`mt-6 grid gap-4 sm:grid-cols-3 ${recarregando}`}>
        <div className="rounded-2xl bg-linear-to-br from-emerald-600 to-emerald-800 p-5 text-white shadow-lg shadow-emerald-900/15">
          <p className="text-sm text-emerald-100">Saldo atual da conta</p>
          {primeiraCarga ? (
            <Esqueleto className="mt-3 h-8 w-40 bg-white/25" />
          ) : (
            <p className="mt-2 text-3xl font-bold tracking-tight">{saldo === null ? '—' : formatarMoeda(saldo)}</p>
          )}
          <p className="mt-1 text-xs text-emerald-100/80">Compras no crédito só descontam quando a fatura é paga</p>
        </div>
        <CartaoResumo
          titulo="Receitas do mês"
          valor={totais.receitas}
          carregando={primeiraCarga}
          cor="text-receita"
          fundo="bg-emerald-50"
          icone={<IconeSetaCima className="h-4 w-4" />}
        />
        <CartaoResumo
          titulo="Despesas do mês"
          valor={totais.despesas}
          carregando={primeiraCarga}
          cor="text-despesa"
          fundo="bg-red-50"
          icone={<IconeSetaBaixo className="h-4 w-4" />}
          detalhe={totais.noCredito > 0 ? `inclui ${formatarMoeda(totais.noCredito)} no crédito` : 'inclui compras no crédito'}
        />
      </div>

      {cartoes.length > 0 && (
        <div className={`mt-6 grid gap-6 lg:grid-cols-5 ${recarregando}`}>
          <Card titulo={`Sua fatura de ${nomeMes}`} className="lg:col-span-3" semEspaco>
            <div className="border-b border-borda px-5 py-4">
              <p className="text-sm text-texto-suave">Você paga</p>
              {primeiraCarga ? (
                <Esqueleto className="mt-2 h-8 w-36" />
              ) : (
                <>
                  <p className="mt-1 text-2xl font-bold tracking-tight text-primaria">{formatarMoeda(faturas.seu)}</p>
                  <p className="mt-1 text-xs text-texto-suave">
                    Total dos cartões {formatarMoeda(faturas.total)} − {formatarMoeda(faturas.daMae)} da sua mãe
                  </p>
                </>
              )}
            </div>
            {primeiraCarga ? (
              <EsqueletoLista linhas={2} />
            ) : suasFaturas.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-texto-suave">Nenhuma fatura vence em {nomeMes}.</p>
            ) : (
              <ul className="divide-y divide-borda">
                {suasFaturas.map((f) => {
                  const fatia = faturas.seu > 0 ? Math.round((f.seu / faturas.seu) * 100) : 0
                  return (
                    <li key={f.cartao.id}>
                      <Link
                        to={`/cartoes/${f.cartao.id}?fatura=${paraMesISO(mes)}`}
                        className="block px-5 py-3.5 transition hover:bg-slate-50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: f.cartao.cor }} />
                            <span className="truncate font-medium">{f.cartao.nome}</span>
                          </span>
                          <span className="shrink-0 font-semibold">{formatarMoeda(f.seu)}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.max(fatia, 0)}%`, backgroundColor: f.cartao.cor }}
                          />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-texto-suave">
                          <span>{fatia}% do total</span>
                          <span className="truncate">
                            vence {formatarDiaMes(f.vencimento)} · {nomeDoStatus[f.status]}
                          </span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card titulo="Compras da sua mãe" className="lg:col-span-2" semEspaco>
            <div className="border-b border-borda px-5 py-4">
              <p className="text-sm text-texto-suave">Ela te deve nas faturas de {nomeMes}</p>
              {primeiraCarga ? (
                <Esqueleto className="mt-2 h-8 w-36" />
              ) : (
                <p className="mt-1 text-2xl font-bold tracking-tight text-despesa">{formatarMoeda(faturas.daMae)}</p>
              )}
            </div>
            {primeiraCarga ? (
              <EsqueletoLista linhas={3} />
            ) : comprasDaMae.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-texto-suave">
                Nenhuma compra dela nestas faturas. Para marcar, abra a compra e ative "Compra da minha mãe".
              </p>
            ) : (
              <ul className="divide-y divide-borda">
                {comprasDaMae.map((t) => {
                  const categoria = t.categoria_id ? categoriaPorId.get(t.categoria_id) : undefined
                  const cor = categoria?.cor ?? '#94a3b8'
                  const fatia = faturas.daMae > 0 ? Math.round((t.valor / faturas.daMae) * 100) : 0
                  const detalhes = [
                    cartaoPorId.get(t.cartao_id ?? '')?.nome,
                    t.total_parcelas ? `parcela ${t.parcela_atual}/${t.total_parcelas}` : null,
                  ].filter(Boolean)
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => editarLancamento(t)}
                        className="block w-full px-5 py-3.5 text-left transition hover:bg-slate-50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
                            <span className="truncate font-medium">{t.local || t.descricao || 'Compra'}</span>
                          </span>
                          <span className="shrink-0 font-semibold">{formatarMoeda(t.valor)}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full" style={{ width: `${fatia}%`, backgroundColor: cor }} />
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-texto-suave">
                          <span>{fatia}% do total</span>
                          <span className="truncate">{detalhes.join(' · ')}</span>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {acertos.length > 0 && (
        <Card
          titulo="Acertos com outras pessoas"
          className={`mt-6 ${recarregando}`}
          semEspaco
          acao={
            <Link to="/acertos" className="text-sm font-semibold text-primaria hover:underline">
              Ver tudo
            </Link>
          }
        >
          <ul className="divide-y divide-borda">
            {acertos.map((a) => {
              const frase = frasesDoSaldo(a)
              return (
                <li key={a.pessoa}>
                  <Link
                    to={`/acertos?pessoa=${encodeURIComponent(a.pessoa)}`}
                    className="flex items-center justify-between gap-3 px-5 py-3.5 transition hover:bg-slate-50"
                  >
                    <span className="truncate text-sm">{frase.titulo}</span>
                    <span className={`shrink-0 font-semibold ${frase.cor}`}>{formatarMoeda(Math.abs(a.saldoCentavos) / 100)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      <div className={`mt-6 grid gap-6 lg:grid-cols-5 ${recarregando}`}>
        <Card titulo="Gastos acumulados no mês" className="lg:col-span-3">
          {primeiraCarga ? (
            <Esqueleto className="h-64" />
          ) : semGastos ? (
            <p className="py-16 text-center text-sm text-texto-suave">
              Nenhum gasto em {nomeMes} nem em {nomeMesAnterior}.
            </p>
          ) : (
            <GraficoGastosDiarios pontos={pontos} nomeMes={nomeMes} nomeMesAnterior={nomeMesAnterior} />
          )}
        </Card>

        <Card titulo="Principais categorias" className="lg:col-span-2" semEspaco>
          {primeiraCarga ? (
            <EsqueletoLista linhas={QUANTAS_CATEGORIAS} />
          ) : porCategoria.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-texto-suave">Nenhum gasto neste mês.</p>
          ) : (
            <ul className="divide-y divide-borda">
              {porCategoria.slice(0, QUANTAS_CATEGORIAS).map((g) => {
                const categoria = g.chave === 'sem' ? undefined : categoriaPorId.get(g.chave)
                const fatia = totais.despesas > 0 ? Math.round((g.atual / totais.despesas) * 100) : 0
                return (
                  <li key={g.chave}>
                    <Link
                      to={`${linkDoMes}&categoria=${g.chave}`}
                      className="block px-5 py-3.5 transition hover:bg-slate-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: categoria?.cor ?? '#94a3b8' }}
                          />
                          <span className="truncate font-medium">{categoria?.nome ?? 'Sem categoria'}</span>
                        </span>
                        <span className="shrink-0 font-semibold">{formatarMoeda(g.atual)}</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${fatia}%`, backgroundColor: categoria?.cor ?? '#94a3b8' }}
                        />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-texto-suave">
                        <span>{fatia}% do total</span>
                        <Variacao atual={g.atual} anterior={g.anterior} nomeMesAnterior={nomeMesAnterior} />
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card
        titulo="Últimos lançamentos"
        className="mt-6"
        semEspaco
        acao={
          transacoes.length > 0 && (
            <Link to={linkDoMes} className="text-sm font-semibold text-primaria hover:underline">
              Ver todos
            </Link>
          )
        }
      >
        {primeiraCarga ? (
          <EsqueletoLista linhas={QUANTOS_ULTIMOS} />
        ) : transacoes.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-texto-suave">
              <IconeLista className="h-6 w-6" />
            </span>
            <p className="mt-4 font-medium">Nenhum lançamento neste mês</p>
            <p className="mt-1 max-w-xs text-sm text-texto-suave">Toque no botão + para registrar uma receita ou despesa.</p>
          </div>
        ) : (
          <div className={recarregando}>
            <ListaLancamentos
              transacoes={transacoes.slice(0, QUANTOS_ULTIMOS)}
              categorias={categorias}
              cartoes={cartoes}
              aoEscolher={editarLancamento}
            />
          </div>
        )}
      </Card>
    </>
  )
}

/** Seta vermelha se o gasto subiu, verde se caiu, comparando com o mês anterior */
function Variacao({ atual, anterior, nomeMesAnterior }: { atual: number; anterior: number; nomeMesAnterior: string }) {
  const variacao = variacaoPercentual(atual, anterior)
  if (variacao === null) return <span>sem gasto em {nomeMesAnterior}</span>

  const valorAnterior = `${formatarMoeda(anterior)} em ${nomeMesAnterior}`
  if (variacao === 0) return <span>igual · {valorAnterior}</span>

  const subiu = variacao > 0
  return (
    <span className="flex items-center gap-1">
      <span className={`flex items-center gap-0.5 font-semibold ${subiu ? 'text-despesa' : 'text-receita'}`}>
        {subiu ? <IconeSetaCima className="h-3.5 w-3.5" /> : <IconeSetaBaixo className="h-3.5 w-3.5" />}
        {subiu ? '+' : '−'}
        {Math.abs(variacao)}%
      </span>
      <span>· {valorAnterior}</span>
    </span>
  )
}

type CartaoResumoProps = {
  titulo: string
  valor: number
  cor: string
  fundo: string
  icone: ReactNode
  detalhe?: string
  carregando?: boolean
}

function CartaoResumo({ titulo, valor, cor, fundo, icone, detalhe, carregando }: CartaoResumoProps) {
  return (
    <div className="rounded-2xl border border-borda bg-white p-5">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${fundo} ${cor}`}>{icone}</span>
        <p className="text-sm text-texto-suave">{titulo}</p>
      </div>
      {carregando ? (
        <Esqueleto className="mt-3 h-7 w-32" />
      ) : (
        <p className={`mt-2 text-2xl font-bold tracking-tight ${cor}`}>{formatarMoeda(valor)}</p>
      )}
      {detalhe && !carregando && <p className="mt-1 text-xs text-texto-suave">{detalhe}</p>}
    </div>
  )
}

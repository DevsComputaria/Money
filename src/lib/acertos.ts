import { hojeISO, paraISO } from './datas'
import { mesDaFatura } from './fatura'
import type { Cartao, Transacao } from '../types/financas'

export type AcertoPessoa = {
  pessoa: string
  /** O que paguei por ela (compras no meu cartão, Pix, parcelas...), menos estornos dessas compras */
  pagueiCentavos: number
  /** O que ela me mandou */
  recebiCentavos: number
  /** Positivo: ela me deve. Negativo: estou com dinheiro dela (mandou mais do que gastei por ela) */
  saldoCentavos: number
  /** Parcelas dela nas próximas faturas (depois da fatura aberta): ainda não entram no saldo */
  aVencerCentavos: number
  quantidade: number
}

const centavos = (valor: number) => Math.round(valor * 100)

/**
 * Lançamento que ainda não chegou: no crédito, o que cai numa fatura depois da que está aberta
 * hoje; fora dele, o que tem data depois de hoje.
 */
export function ehAVencer(t: Transacao, cartaoPorId: Map<string, Cartao>, hoje = new Date()) {
  const cartao = t.cartao_id ? cartaoPorId.get(t.cartao_id) : undefined
  if (t.forma === 'credito' && cartao && t.fatura) {
    return t.fatura > paraISO(mesDaFatura(hoje, cartao.dia_fechamento, cartao.dia_vencimento))
  }
  return t.data > hojeISO()
}

/** Junta os lançamentos de outras pessoas por pessoa; quem tem maior saldo (me deve mais) vem primeiro */
export function acertosPorPessoa(transacoes: Transacao[], cartoes: Cartao[]): AcertoPessoa[] {
  const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]))
  const porPessoa = new Map<string, AcertoPessoa>()
  for (const t of transacoes) {
    if (!t.terceiro) continue
    const acerto = porPessoa.get(t.terceiro) ?? {
      pessoa: t.terceiro,
      pagueiCentavos: 0,
      recebiCentavos: 0,
      saldoCentavos: 0,
      aVencerCentavos: 0,
      quantidade: 0,
    }
    if (t.tipo === 'despesa' && ehAVencer(t, cartaoPorId)) acerto.aVencerCentavos += centavos(t.valor)
    else if (t.tipo === 'despesa') acerto.pagueiCentavos += centavos(t.valor)
    // Crédito no cartão (estorno de uma compra dela) desconta do que paguei
    else if (t.forma === 'credito') acerto.pagueiCentavos -= centavos(t.valor)
    else acerto.recebiCentavos += centavos(t.valor)
    acerto.saldoCentavos = acerto.pagueiCentavos - acerto.recebiCentavos
    acerto.quantidade++
    porPessoa.set(t.terceiro, acerto)
  }
  return [...porPessoa.values()].sort((a, b) => b.saldoCentavos - a.saldoCentavos)
}

export type MesDoAcerto = {
  /** "2026-11" */
  chave: string
  /** O que ela deve no mês: compras dela nas faturas que vencem no mês e outras contas pagas por ela no mês */
  deveCentavos: number
  /** O que ela me mandou no mês */
  pagouCentavos: number
  /** Só tem parcelas de faturas que ainda não chegaram */
  aVencer: boolean
}

/**
 * Mês a mês de uma pessoa, do mais antigo para o mais recente. Compra no cartão conta no mês em que a
 * fatura vence; o resto (contas fora do cartão e o que ela mandou), no mês da data.
 */
export function acertoMesAMes(transacoes: Transacao[], pessoa: string, cartoes: Cartao[]): MesDoAcerto[] {
  const cartaoPorId = new Map(cartoes.map((c) => [c.id, c]))
  const porMes = new Map<string, MesDoAcerto & { temAtual: boolean }>()
  for (const t of transacoes) {
    if (t.terceiro !== pessoa) continue
    const chave = (t.forma === 'credito' && t.fatura ? t.fatura : t.data).slice(0, 7)
    const mes = porMes.get(chave) ?? { chave, deveCentavos: 0, pagouCentavos: 0, aVencer: false, temAtual: false }
    if (t.tipo === 'despesa') mes.deveCentavos += centavos(t.valor)
    // Estorno de uma compra dela no cartão desconta do que ela deve
    else if (t.forma === 'credito') mes.deveCentavos -= centavos(t.valor)
    else mes.pagouCentavos += centavos(t.valor)
    if (t.tipo !== 'despesa' || !ehAVencer(t, cartaoPorId)) mes.temAtual = true
    porMes.set(chave, mes)
  }
  return [...porMes.values()]
    .map(({ temAtual, ...mes }) => ({ ...mes, aVencer: !temAtual }))
    .sort((a, b) => a.chave.localeCompare(b.chave))
}

/** "Mãe te deve R$ 50,00" / "Você está com R$ 30,00 da Mãe" / "Tudo acertado" */
export function frasesDoSaldo(a: AcertoPessoa) {
  if (a.saldoCentavos > 0) return { titulo: `${a.pessoa} te deve`, cor: 'text-receita' }
  if (a.saldoCentavos < 0) return { titulo: `Você está com dinheiro de ${a.pessoa}`, cor: 'text-despesa' }
  return { titulo: 'Tudo acertado', cor: 'text-texto-suave' }
}

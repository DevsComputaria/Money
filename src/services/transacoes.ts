import { deISO, intervaloDoMes, paraISO, somarMeses } from '../lib/datas'
import { dividirEmParcelas, mesDaFatura } from '../lib/fatura'
import { supabase } from '../lib/supabase'
import type { Cartao, FormaPagamento, NovaTransacao, TipoTransacao, Transacao } from '../types/financas'

/** O que o formulário de lançamento envia */
export type DadosLancamento = {
  tipo: TipoTransacao
  forma: FormaPagamento
  valorCentavos: number
  local: string
  descricao: string
  observacao: string
  categoriaId: string | null
  /** "2026-10-23" */
  data: string
  contaId: string | null
  /** Obrigatório quando forma = 'credito' */
  cartao: Cartao | null
  /** 1 a 12; só vale no crédito */
  parcelas: number
  /** Transferência entre as próprias contas (não vale no crédito) */
  transferencia: boolean
  /** Compra no crédito que é da mãe: entra no quanto ela deve na fatura */
  daMae: boolean
}

const ERRO_SALVAR = 'Não foi possível salvar. Tente de novo.'

export async function listarTransacoesDoMes(mes: Date) {
  const [inicio, fim] = intervaloDoMes(mes)
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .gte('data', inicio)
    .lte('data', fim)
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data as Transacao[]
}

/** Saldo atual calculado no banco (função saldo_atual) */
export async function buscarSaldoAtual() {
  const { data, error } = await supabase.rpc('saldo_atual')
  if (error) throw error
  return Number(data)
}

function camposComuns(d: DadosLancamento) {
  return {
    tipo: d.tipo,
    forma: d.forma,
    local: d.local.trim() || null,
    descricao: d.descricao.trim() || null,
    observacao: d.observacao.trim() || null,
    categoria_id: d.categoriaId,
    transferencia_interna: d.forma !== 'credito' && d.transferencia,
    da_mae: d.forma === 'credito' && d.tipo === 'despesa' && d.daMae,
    // compra no crédito não sai de nenhuma conta na hora (só o pagamento da fatura)
    conta_id: d.forma === 'credito' ? null : d.contaId,
    cartao_id: d.forma === 'credito' ? (d.cartao?.id ?? null) : null,
  }
}

function faturaDaCompra(d: DadosLancamento) {
  if (d.forma !== 'credito' || !d.cartao) return null
  return mesDaFatura(deISO(d.data), d.cartao.dia_fechamento, d.cartao.dia_vencimento)
}

/** Cria o lançamento; no crédito parcelado, cria uma transação por parcela, cada uma na sua fatura */
export async function criarLancamento(d: DadosLancamento) {
  const comuns = camposComuns(d)
  const fatura = faturaDaCompra(d)
  let linhas: NovaTransacao[]

  if (fatura && d.parcelas > 1) {
    const dataCompra = deISO(d.data)
    const grupo = crypto.randomUUID()
    linhas = dividirEmParcelas(d.valorCentavos, d.parcelas).map((centavos, i) => ({
      ...comuns,
      valor: centavos / 100,
      data: paraISO(somarMeses(dataCompra, i)),
      fatura: paraISO(somarMeses(fatura, i)),
      parcela_atual: i + 1,
      total_parcelas: d.parcelas,
      grupo_parcela: grupo,
    }))
  } else {
    linhas = [{ ...comuns, valor: d.valorCentavos / 100, data: d.data, fatura: fatura ? paraISO(fatura) : null }]
  }

  // Um único insert: ou entram todas as parcelas, ou nenhuma
  const { error } = await supabase.from('transacoes').insert(linhas)
  if (error) {
    console.error(error)
    throw new Error(ERRO_SALVAR)
  }
}

/**
 * Atualiza um lançamento. Numa parcela, só valor, local, descrição, observação e categoria mudam
 * (forma, cartão e datas valem para o grupo; para mudar, exclua e lance de novo).
 * Num pagamento de fatura, tipo e forma ficam como estão.
 * Numa importada do banco, só local, descrição, observação e categoria mudam.
 */
export async function atualizarLancamento(original: Transacao, d: DadosLancamento) {
  const comuns = camposComuns(d)
  // Importada: o resto vem do banco e a sincronização mantém
  const doUsuario = {
    local: comuns.local,
    descricao: comuns.descricao,
    observacao: comuns.observacao,
    categoria_id: comuns.categoria_id,
    ...(original.forma === 'credito' || original.pagamento_cartao_id ? {} : { transferencia_interna: d.transferencia }),
    ...(ehCompraNoCredito(original) ? { da_mae: d.daMae } : {}),
  }
  const mudancas = original.origem === 'pluggy'
    ? doUsuario
    : original.grupo_parcela
    ? {
        valor: d.valorCentavos / 100,
        local: comuns.local,
        descricao: comuns.descricao,
        observacao: comuns.observacao,
        categoria_id: comuns.categoria_id,
        da_mae: comuns.da_mae,
      }
    : original.pagamento_cartao_id
      ? {
          valor: d.valorCentavos / 100,
          local: comuns.local,
          descricao: comuns.descricao,
          observacao: comuns.observacao,
          categoria_id: comuns.categoria_id,
          conta_id: d.contaId,
          data: d.data,
        }
      : (() => {
        const fatura = faturaDaCompra(d)
        return { ...comuns, valor: d.valorCentavos / 100, data: d.data, fatura: fatura ? paraISO(fatura) : null }
      })()

  const { error } = await supabase.from('transacoes').update(mudancas).eq('id', original.id)
  if (error) {
    console.error(error)
    throw new Error(ERRO_SALVAR)
  }
  if (ehCompraNoCredito(original) && original.total_parcelas && d.daMae !== original.da_mae) {
    await marcarParcelasDaMae(original, d.daMae)
  }
}

const ehCompraNoCredito = (t: Transacao) => t.forma === 'credito' && t.tipo === 'despesa'

// "Jim.Com* 36827242 Eli 2/4" → "Jim.Com* 36827242 Eli"
const semNumeroDaParcela = (texto: string | null) => (texto ?? '').replace(/\s*\d+\/\d+\s*$/, '')

/**
 * "É da mãe" vale para a compra inteira, não só para uma parcela. Lançada aqui, as parcelas têm o mesmo
 * grupo; importada do banco, são as do mesmo cartão com a mesma descrição e número de parcelas (o valor
 * pode mudar 1 centavo entre elas).
 */
async function marcarParcelasDaMae(original: Transacao, daMae: boolean) {
  let ids: string[]
  if (original.grupo_parcela) {
    const { data, error } = await supabase.from('transacoes').select('id').eq('grupo_parcela', original.grupo_parcela)
    if (error) throw new Error(ERRO_SALVAR)
    ids = data.map((t) => t.id)
  } else {
    const { data, error } = await supabase
      .from('transacoes')
      .select('id, descricao, valor')
      .eq('cartao_id', original.cartao_id!)
      .eq('total_parcelas', original.total_parcelas!)
      .eq('tipo', 'despesa')
    if (error) throw new Error(ERRO_SALVAR)
    const base = semNumeroDaParcela(original.descricao)
    ids = data
      .filter((t) => semNumeroDaParcela(t.descricao) === base && Math.abs(t.valor - original.valor) <= 0.05)
      .map((t) => t.id)
  }
  const { error } = await supabase.from('transacoes').update({ da_mae: daMae }).in('id', ids)
  if (error) throw new Error('Esta parcela foi salva, mas não deu para marcar as outras parcelas da compra.')
}

/** Compras de todos os cartões nas faturas que vencem no mês (fatura = dia 1 do mês de vencimento) */
export async function listarComprasDasFaturas(fatura: Date) {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .eq('fatura', paraISO(fatura))
    .not('cartao_id', 'is', null)
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data as Transacao[]
}

/** Compras e parcelas que caem numa fatura do cartão, da mais recente para a mais antiga */
export async function listarTransacoesDaFatura(cartaoId: string, fatura: Date) {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .eq('cartao_id', cartaoId)
    .eq('fatura', paraISO(fatura))
    .order('data', { ascending: false })
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data as Transacao[]
}

/** Total (em centavos) de cada fatura do cartão entre duas faturas, inclusive. Chave: "2026-11-01" */
export async function totaisDasFaturas(cartaoId: string, de: Date, ate: Date) {
  const { data, error } = await supabase
    .from('transacoes')
    .select('fatura, valor, tipo')
    .eq('cartao_id', cartaoId)
    .gte('fatura', paraISO(de))
    .lte('fatura', paraISO(ate))
  if (error) throw error
  const totais = new Map<string, number>()
  for (const t of data) {
    if (!t.fatura) continue
    const centavos = Math.round(t.valor * 100) * (t.tipo === 'despesa' ? 1 : -1)
    totais.set(t.fatura, (totais.get(t.fatura) ?? 0) + centavos)
  }
  return totais
}

/** Pagamento que quitou a fatura, ou null se ela não foi paga */
export async function buscarPagamentoDaFatura(cartaoId: string, fatura: Date) {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .eq('pagamento_cartao_id', cartaoId)
    .eq('pagamento_fatura', paraISO(fatura))
    .maybeSingle()
  if (error) throw error
  return data as Transacao | null
}

type DadosPagamento = {
  cartao: Cartao
  fatura: Date
  valorCentavos: number
  contaId: string | null
  /** "2026-10-23" */
  data: string
  descricao: string
}

/** Registra o pagamento da fatura como despesa no débito; a fatura passa a "Paga" */
export async function pagarFatura(p: DadosPagamento) {
  const { error } = await supabase.from('transacoes').insert({
    tipo: 'despesa',
    forma: 'debito',
    valor: p.valorCentavos / 100,
    data: p.data,
    conta_id: p.contaId,
    local: `Fatura ${p.cartao.nome}`,
    descricao: p.descricao,
    pagamento_cartao_id: p.cartao.id,
    pagamento_fatura: paraISO(p.fatura),
  })
  if (error) {
    console.error(error)
    if (error.code === '23505') throw new Error('Essa fatura já foi paga.')
    throw new Error('Não foi possível registrar o pagamento. Tente de novo.')
  }
}

export async function excluirTransacao(id: string) {
  const { error } = await supabase.from('transacoes').delete().eq('id', id)
  if (error) throw new Error('Não foi possível excluir. Tente de novo.')
}

export async function excluirGrupoDeParcelas(grupo: string) {
  const { error } = await supabase.from('transacoes').delete().eq('grupo_parcela', grupo)
  if (error) throw new Error('Não foi possível excluir. Tente de novo.')
}

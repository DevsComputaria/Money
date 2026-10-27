import type { Transacao } from '../types/financas'

export type AcertoPessoa = {
  pessoa: string
  /** O que paguei por ela (compras no meu cartão, Pix, parcelas...), menos estornos dessas compras */
  pagueiCentavos: number
  /** O que ela me mandou */
  recebiCentavos: number
  /** Positivo: ela me deve. Negativo: estou com dinheiro dela (mandou mais do que gastei por ela) */
  saldoCentavos: number
  quantidade: number
}

const centavos = (valor: number) => Math.round(valor * 100)

/**
 * Junta os lançamentos de outras pessoas por pessoa; quem tem maior saldo (me deve mais) vem primeiro.
 * Quando um mês fecha com dinheiro da pessoa sobrando comigo, ele virou meu: a conta dela recomeça do zero no mês
 * seguinte. Se ela fechou o mês me devendo, a dívida continua. Empréstimo não entra nisso: fica em aberto até ser
 * devolvido, em qualquer mês.
 */
export function acertosPorPessoa(transacoes: Transacao[], hoje = new Date()): AcertoPessoa[] {
  const porPessoa = new Map<string, AcertoPessoa>()
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
  // Só a parte de fora de empréstimos zera; o empréstimo em aberto continua
  const emprestado = new Map<string, number>()
  const fecharMes = () => {
    for (const [pessoa, a] of porPessoa) {
      const doEmprestimo = emprestado.get(pessoa) ?? 0
      if (a.saldoCentavos - doEmprestimo >= 0) continue
      if (doEmprestimo === 0) {
        porPessoa.delete(pessoa)
        continue
      }
      a.pagueiCentavos = Math.max(doEmprestimo, 0)
      a.recebiCentavos = Math.max(-doEmprestimo, 0)
      a.saldoCentavos = doEmprestimo
    }
  }
  let mesAberto: string | null = null
  for (const t of [...transacoes].sort((a, b) => a.data.localeCompare(b.data))) {
    if (!t.terceiro) continue
    const mes = t.data.slice(0, 7)
    if (mesAberto !== null && mes !== mesAberto && mesAberto < mesAtual) fecharMes()
    mesAberto = mes
    const acerto = porPessoa.get(t.terceiro) ?? {
      pessoa: t.terceiro,
      pagueiCentavos: 0,
      recebiCentavos: 0,
      saldoCentavos: 0,
      quantidade: 0,
    }
    if (t.tipo === 'despesa') acerto.pagueiCentavos += centavos(t.valor)
    // Crédito no cartão (estorno de uma compra dela) desconta do que paguei
    else if (t.forma === 'credito') acerto.pagueiCentavos -= centavos(t.valor)
    else acerto.recebiCentavos += centavos(t.valor)
    acerto.saldoCentavos = acerto.pagueiCentavos - acerto.recebiCentavos
    if (t.emprestimo) {
      const sinal = t.tipo === 'despesa' ? 1 : -1
      emprestado.set(t.terceiro, (emprestado.get(t.terceiro) ?? 0) + sinal * centavos(t.valor))
    }
    acerto.quantidade++
    porPessoa.set(t.terceiro, acerto)
  }
  if (mesAberto !== null && mesAberto < mesAtual) fecharMes()
  return [...porPessoa.values()].sort((a, b) => b.saldoCentavos - a.saldoCentavos)
}

/** "Mãe te deve R$ 50,00" / "Você está com R$ 30,00 da Mãe" / "Tudo acertado" */
export function frasesDoSaldo(a: AcertoPessoa) {
  if (a.saldoCentavos > 0) return { titulo: `${a.pessoa} te deve`, cor: 'text-receita' }
  if (a.saldoCentavos < 0) return { titulo: `Você está com dinheiro de ${a.pessoa}`, cor: 'text-despesa' }
  return { titulo: 'Tudo acertado', cor: 'text-texto-suave' }
}

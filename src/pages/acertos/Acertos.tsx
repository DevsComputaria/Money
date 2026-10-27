import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import Alerta from '../../components/Alerta'
import Card from '../../components/Card'
import { EsqueletoLista } from '../../components/Esqueleto'
import ListaLancamentos from '../../components/ListaLancamentos'
import { IconeChevronEsquerda } from '../../components/icones'
import { useLancamentos } from '../../hooks/useLancamentos'
import { acertosPorPessoa, frasesDoSaldo } from '../../lib/acertos'
import { formatarMoeda } from '../../lib/formatar'
import { listarCartoes } from '../../services/cartoes'
import { listarCategorias } from '../../services/categorias'
import { listarLancamentosDeTerceiros } from '../../services/transacoes'
import type { Cartao, Categoria, Transacao } from '../../types/financas'

/**
 * Acertos com outras pessoas: o que paguei por cada uma, o que ela me mandou e quem deve a quem.
 * Endereço: /acertos?pessoa=Mãe
 */
export default function Acertos() {
  const { versao, editarLancamento } = useLancamentos()
  const [parametros, setParametros] = useSearchParams()
  const pessoa = parametros.get('pessoa')

  const [transacoes, setTransacoes] = useState<Transacao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let ativo = true
    setCarregando(true)
    Promise.all([listarLancamentosDeTerceiros(), listarCategorias(), listarCartoes()])
      .then(([ts, cats, crts]) => {
        if (!ativo) return
        setTransacoes(ts)
        setCategorias(cats)
        setCartoes(crts)
        setErro('')
      })
      .catch(() => ativo && setErro('Não foi possível carregar os acertos.'))
      .finally(() => ativo && setCarregando(false))
    return () => {
      ativo = false
    }
  }, [versao])

  const acertos = useMemo(() => acertosPorPessoa(transacoes), [transacoes])
  const escolhida = acertos.find((a) => a.pessoa === pessoa) ?? (acertos.length === 1 ? acertos[0] : null)
  const daPessoa = useMemo(
    () => (escolhida ? transacoes.filter((t) => t.terceiro === escolhida.pessoa) : []),
    [transacoes, escolhida],
  )

  function escolher(nome: string) {
    setParametros(nome === escolhida?.pessoa ? {} : { pessoa: nome }, { replace: true })
  }

  return (
    <>
      <Link
        to="/dashboard"
        className="-ml-1 inline-flex items-center gap-1 text-sm font-medium text-texto-suave transition hover:text-texto"
      >
        <IconeChevronEsquerda className="h-4 w-4" />
        Início
      </Link>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">Acertos</h1>
      <p className="mt-1 text-sm text-texto-suave">
        Lançamentos marcados como de outra pessoa. Eles ficam fora das suas receitas e despesas; aqui você vê o que pagou
        por cada uma e o que ela já te mandou.
      </p>

      {erro && (
        <div className="mt-4">
          <Alerta>{erro}</Alerta>
        </div>
      )}

      {carregando && transacoes.length === 0 ? (
        <Card className="mt-6" semEspaco>
          <EsqueletoLista linhas={3} />
        </Card>
      ) : acertos.length === 0 ? (
        <Card className="mt-6">
          <p className="py-8 text-center text-sm text-texto-suave">
            Nenhum lançamento de outra pessoa ainda. Ao editar um lançamento, marque &quot;É de outra pessoa&quot;.
          </p>
        </Card>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {acertos.map((a) => {
            const frase = frasesDoSaldo(a)
            const ativa = escolhida?.pessoa === a.pessoa
            return (
              <button
                key={a.pessoa}
                onClick={() => escolher(a.pessoa)}
                aria-pressed={ativa}
                className={`rounded-2xl border bg-white p-5 text-left transition ${ativa ? 'border-primaria ring-4 ring-primaria/10' : 'border-borda hover:border-slate-300'}`}
              >
                <p className="text-sm text-texto-suave">{frase.titulo}</p>
                <p className={`mt-1 text-2xl font-bold tracking-tight ${frase.cor}`}>
                  {formatarMoeda(Math.abs(a.saldoCentavos) / 100)}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-texto-suave">
                  <div>
                    <dt>Paguei por {a.pessoa}</dt>
                    <dd className="text-sm font-semibold text-texto">{formatarMoeda(a.pagueiCentavos / 100)}</dd>
                  </div>
                  <div>
                    <dt>{a.pessoa} me mandou</dt>
                    <dd className="text-sm font-semibold text-texto">{formatarMoeda(a.recebiCentavos / 100)}</dd>
                  </div>
                </dl>
              </button>
            )
          })}
        </div>
      )}

      {escolhida && (
        <Card titulo={`Lançamentos de ${escolhida.pessoa}`} className="mt-6" semEspaco>
          <ListaLancamentos transacoes={daPessoa} categorias={categorias} cartoes={cartoes} aoEscolher={editarLancamento} />
        </Card>
      )}
    </>
  )
}

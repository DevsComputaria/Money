import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { abas } from './BottomNav'
import { IconeBanco, IconeLista, IconeMais, IconeSair, IconeUsuario } from './icones'
import { sair } from '../services/auth'

// No computador cabe mais: telas que no celular só abrem por link também ficam no menu
const extras: { to: string; label: string; icone: ReactNode }[] = [
  { to: '/lancamentos', label: 'Lançamentos', icone: <IconeLista /> },
  { to: '/acertos', label: 'Acertos', icone: <IconeUsuario /> },
  { to: '/bancos', label: 'Bancos', icone: <IconeBanco /> },
]

/** Navegação do computador (lg+): fica no lugar da barra do topo, da BottomNav e do botão flutuante */
export default function BarraLateral({ aoNovoLancamento }: { aoNovoLancamento: () => void }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-borda bg-white lg:flex">
      <div className="flex items-center gap-2.5 px-5 pt-6 pb-5">
        <img src="/icon.svg" alt="" className="h-8 w-8" />
        <span className="font-semibold">Meu Bolso</span>
      </div>

      <div className="px-3">
        <button
          onClick={aoNovoLancamento}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primaria text-sm font-semibold text-white shadow-sm shadow-emerald-900/20 transition hover:bg-primaria-escura active:scale-[0.98]"
        >
          <IconeMais className="h-5 w-5" />
          Novo lançamento
        </button>
      </div>

      <nav className="mt-5 flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
          {abas.map((aba) => (
            <Item key={aba.to} {...aba} />
          ))}
        </ul>
        <div className="mx-3 my-3 border-t border-borda" />
        <ul className="space-y-0.5">
          {extras.map((aba) => (
            <Item key={aba.to} {...aba} />
          ))}
        </ul>
      </nav>

      <div className="border-t border-borda p-3">
        <button
          onClick={sair}
          className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-texto-suave transition hover:bg-slate-100 hover:text-texto"
        >
          <IconeSair className="h-5 w-5" />
          Sair
        </button>
      </div>
    </aside>
  )
}

function Item({ to, label, icone }: { to: string; label: string; icone: ReactNode }) {
  return (
    <li>
      <NavLink
        to={to}
        className={({ isActive }) =>
          `flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition ${isActive ? 'bg-emerald-50 text-primaria' : 'text-texto-suave hover:bg-slate-100 hover:text-texto'}`
        }
      >
        {icone}
        {label}
      </NavLink>
    </li>
  )
}

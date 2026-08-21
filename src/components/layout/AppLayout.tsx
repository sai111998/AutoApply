import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Briefcase,
  FileText,
  Gauge,
  LayoutDashboard,
  LogOut,
  ScanSearch,
  Settings,
  UserRound,
} from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useState } from 'react'

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/profile', label: 'My Profile', icon: UserRound },
  { to: '/resume', label: 'Master Resume', icon: FileText },
  { to: '/analyze', label: 'Job Analysis', icon: ScanSearch },
  { to: '/applications', label: 'Applications', icon: Briefcase },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppLayout() {
  const { user, isDemo, signOut } = useAuth()
  const { profile, loading, error } = useWorkspace()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <aside
        className={`z-20 flex flex-col bg-navy px-4 py-5 text-white max-[960px]:fixed max-[960px]:inset-y-0 max-[960px]:left-0 max-[960px]:w-72 max-[960px]:transition-transform ${
          open ? 'max-[960px]:translate-x-0' : 'max-[960px]:-translate-x-full'
        }`}
      >
        <div className="px-2 pb-6">
          <BrandMark light />
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/'}
              onClick={() => setOpen(false)}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              <link.icon size={18} />
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 rounded-2xl bg-white/5 p-3">
          <p className="text-sm font-semibold text-white">{profile.fullName || user?.email}</p>
          <p className="truncate text-xs text-white/60">{user?.email}</p>
          {isDemo && (
            <p className="mt-2 rounded-lg bg-gold/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gold">
              Demo data
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="mt-3 inline-flex items-center gap-2 text-sm text-white/70 hover:text-white"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>

      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-10 bg-navy/40 min-[961px]:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-8">
          <button
            type="button"
            className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold min-[961px]:hidden"
            onClick={() => setOpen(true)}
          >
            Menu
          </button>
          <div className="hidden items-center gap-2 text-slate-ink min-[961px]:flex">
            <Gauge size={16} />
            <span className="text-sm">Job search cockpit</span>
          </div>
          <div className="ml-auto text-right text-sm text-slate-ink">
            <p className="font-semibold text-ink">{profile.location || 'Add a location'}</p>
            <p>{profile.targetJobTitles[0] || 'Set a target role'}</p>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {error && (
            <div className="mb-4 rounded-2xl border border-clay/30 bg-rose-50 px-4 py-3 text-sm text-clay">
              {error}
            </div>
          )}
          {loading ? (
            <div className="card px-6 py-16 text-center text-slate-ink">Loading workspace…</div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  )
}

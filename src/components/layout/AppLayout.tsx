import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Briefcase,
  FileText,
  LogOut,
  ScanSearch,
  Settings,
  UserRound,
  LayoutDashboard,
  Menu,
} from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { useAuth } from '@/context/AuthContext'
import { useWorkspace } from '@/context/WorkspaceContext'
import { useState } from 'react'

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
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
    navigate('/')
  }

  return (
    <div className="app-shell">
      <aside
        className={`z-20 flex flex-col border-r border-line bg-white px-3 py-5 max-[960px]:fixed max-[960px]:inset-y-0 max-[960px]:left-0 max-[960px]:w-72 max-[960px]:transition-transform ${
          open ? 'max-[960px]:translate-x-0' : 'max-[960px]:-translate-x-full'
        }`}
      >
        <div className="px-2 pb-6">
          <BrandMark />
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/dashboard'}
              onClick={() => setOpen(false)}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            >
              <link.icon size={18} />
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 rounded-2xl border border-line bg-canvas p-3">
          <p className="text-sm font-semibold text-charcoal">{profile.fullName || user?.email}</p>
          <p className="truncate text-xs text-muted">{user?.email}</p>
          {isDemo && (
            <p className="mt-2 rounded-lg bg-olive-soft px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-olive-dark">
              Demo data
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="mt-3 inline-flex items-center gap-2 text-sm text-muted transition hover:text-olive-dark"
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
          className="fixed inset-0 z-10 bg-charcoal/20 min-[961px]:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-white/80 px-4 py-3 backdrop-blur-sm sm:px-8">
          <button
            type="button"
            className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold min-[961px]:hidden"
            onClick={() => setOpen(true)}
          >
            <span className="inline-flex items-center gap-2">
              <Menu size={16} />
              Menu
            </span>
          </button>
          <div className="hidden text-sm text-muted min-[961px]:block">Job search workspace</div>
          <div className="ml-auto text-right text-sm">
            <p className="font-semibold text-charcoal">{profile.location || 'Add a location'}</p>
            <p className="text-muted">{profile.targetJobTitles[0] || 'Set a target role'}</p>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8">
          {error && (
            <div className="mb-4 rounded-2xl border border-[#ead5cf] bg-[#fdf7f5] px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}
          {loading ? (
            <div className="card px-6 py-16 text-center text-muted">Loading workspace…</div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  )
}

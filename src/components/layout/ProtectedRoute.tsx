import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper text-slate-ink">
        Preparing JobPilot…
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

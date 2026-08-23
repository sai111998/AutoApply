import { Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ToastProvider } from '@/context/ToastContext'
import { AuthProvider, useAuth } from '@/context/AuthContext'
import { WorkspaceProvider } from '@/context/WorkspaceContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { ApplicationsPage } from '@/pages/ApplicationsPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { JobAnalysisPage } from '@/pages/JobAnalysisPage'
import { LandingPage } from '@/pages/LandingPage'
import { LegalPlaceholderPage } from '@/pages/LegalPlaceholderPage'
import { LoginPage } from '@/pages/LoginPage'
import { MatchResultsPage } from '@/pages/MatchResultsPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { ResumePage } from '@/pages/ResumePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SignupPage } from '@/pages/SignupPage'

function Preparing() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas text-muted">Preparing JobPilot…</div>
  )
}

function LandingGate() {
  const { user, loading } = useAuth()
  if (loading) return <Preparing />
  if (user) return <Navigate to="/dashboard" replace />
  return <LandingPage />
}

function CatchAll() {
  const { user, loading } = useAuth()
  if (loading) return <Preparing />
  return <Navigate to={user ? '/dashboard' : '/'} replace />
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <Routes>
              <Route path="/" element={<LandingGate />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route
                path="/about"
                element={
                  <LegalPlaceholderPage
                    title="About"
                    summary="JobPilot AI is a workspace for organizing a job search, reviewing how a role fits your resume, and tracking applications. AI suggestions are meant to be checked by you."
                  />
                }
              />
              <Route
                path="/privacy"
                element={
                  <LegalPlaceholderPage
                    title="Privacy"
                    summary="A full privacy notice is not published yet. When it is, it will describe how account and workspace data are handled."
                  />
                }
              />
              <Route
                path="/terms"
                element={
                  <LegalPlaceholderPage
                    title="Terms"
                    summary="Terms of use are not published yet. JobPilot AI does not guarantee interviews, offers, or employment."
                  />
                }
              />
              <Route
                path="/contact"
                element={
                  <LegalPlaceholderPage
                    title="Contact"
                    summary="A public contact channel will be listed here when the product is generally available."
                  />
                }
              />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route path="/resume" element={<ResumePage />} />
                  <Route path="/analyze" element={<JobAnalysisPage />} />
                  <Route path="/matches/:matchId" element={<MatchResultsPage />} />
                  <Route path="/applications" element={<ApplicationsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<CatchAll />} />
            </Routes>
          </WorkspaceProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

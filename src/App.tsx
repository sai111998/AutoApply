import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { WorkspaceProvider } from '@/context/WorkspaceContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { ApplicationsPage } from '@/pages/ApplicationsPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { JobAnalysisPage } from '@/pages/JobAnalysisPage'
import { LoginPage } from '@/pages/LoginPage'
import { MatchResultsPage } from '@/pages/MatchResultsPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { ResumePage } from '@/pages/ResumePage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SignupPage } from '@/pages/SignupPage'

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/resume" element={<ResumePage />} />
              <Route path="/analyze" element={<JobAnalysisPage />} />
              <Route path="/matches/:matchId" element={<MatchResultsPage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </WorkspaceProvider>
    </AuthProvider>
  )
}

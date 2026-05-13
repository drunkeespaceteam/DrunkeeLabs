import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import { RequireRole, RedirectIfAuth, RequireAuth } from './components/RouteGuard'
import ProtectedAdminRoute from './components/ProtectedAdminRoute'

import Signup from './pages/Signup'
import Signin from './pages/Signin'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import MentorDashboard from './pages/MentorDashboard'
import CreateTaskPage from './pages/CreateTaskPage'
import TaskWorkspace from './pages/TaskWorkspace'
import Submissions from './pages/Submissions'
import MentorTaskSubmissions from './pages/MentorTaskSubmissions'
import Profile from './pages/Profile'
import EditProfile from './pages/EditProfile'
import AdminDashboard from './pages/AdminDashboard'
import TargetMarketplace from './pages/TargetMarketplace'
import ArenaHome from './pages/arena/ArenaHome'
import ArenaLobby from './pages/arena/ArenaLobby'
import ArenaTeam from './pages/arena/ArenaTeam'
import ArenaMatch from './pages/arena/ArenaMatch'
import ArenaTeamsMarketplace from './pages/arena/ArenaTeamsMarketplace'
import ArenaInviteJoin from './pages/arena/ArenaInviteJoin'
import ArenaRewards from './pages/arena/ArenaRewards'

function AppRoutes() {
  const location = useLocation()

  return (
      <Routes location={location}>
        {/* Public / auth pages */}
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/signup" element={
          <RedirectIfAuth><Signup /></RedirectIfAuth>
        } />
        <Route path="/login" element={
          <RedirectIfAuth><Signin /></RedirectIfAuth>
        } />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Shared Authenticated Routes */}
        <Route path="/profile" element={
          <RequireAuth><Profile /></RequireAuth>
        } />
        <Route path="/settings/profile" element={
          <RequireAuth><EditProfile /></RequireAuth>
        } />

        {/* Employee routes */}
        <Route path="/dashboard" element={
          <RequireRole role="employee"><Dashboard /></RequireRole>
        } />
        <Route path="/marketplace" element={
          <RequireRole role="employee"><TargetMarketplace /></RequireRole>
        } />
        <Route path="/task/:id" element={
          <RequireRole role="employee"><TaskWorkspace /></RequireRole>
        } />
        <Route path="/submissions" element={
          <RequireRole role="employee"><Submissions /></RequireRole>
        } />

        {/* Mentor routes */}
        <Route path="/mentor/dashboard" element={
          <RequireRole role="mentor"><MentorDashboard /></RequireRole>
        } />
        <Route path="/mentor/create-task" element={
          <RequireRole role="mentor"><CreateTaskPage /></RequireRole>
        } />
        <Route path="/mentor/task/:id/submissions" element={
          <RequireRole role="mentor"><MentorTaskSubmissions /></RequireRole>
        } />

        {/* Admin routes */}
        <Route path="/admin" element={
          <ProtectedAdminRoute><AdminDashboard /></ProtectedAdminRoute>
        } />

        {/* Arena routes (isolated module) */}
        <Route path="/arena" element={
          <RequireAuth><ArenaHome /></RequireAuth>
        } />
        <Route path="/arena/lobby" element={
          <RequireAuth><ArenaLobby /></RequireAuth>
        } />
        <Route path="/arena/teams" element={
          <RequireAuth><ArenaTeamsMarketplace /></RequireAuth>
        } />
        <Route path="/arena/team/:teamSlug" element={
          <RequireAuth><ArenaTeam /></RequireAuth>
        } />
        <Route path="/arena/rewards" element={
          <RequireAuth><ArenaRewards /></RequireAuth>
        } />
        <Route path="/arena/join/:teamSlug" element={
          <RequireAuth><ArenaInviteJoin /></RequireAuth>
        } />
        <Route path="/arena/match/:matchId" element={
          <RequireAuth><ArenaMatch /></RequireAuth>
        } />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App

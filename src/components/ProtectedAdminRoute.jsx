import { RequireAdmin } from './RouteGuard'

export default function ProtectedAdminRoute({ children }) {
  return <RequireAdmin>{children}</RequireAdmin>
}

import { useState } from 'react'
import { Login } from '@/screens/Login'
import type { UserToken } from '../app/auth/devicecode'

export default function App() {
  const [token, setToken] = useState<UserToken | null>(null)

  if (!token) {
    return <Login onAuthenticated={setToken} />
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Authenticated ✓</p>
    </div>
  )
}

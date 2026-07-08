'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

interface BackendUser {
  id: string
  email: string
  name: string | null
  authRole: string
  createdAt: string
}

async function getToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/token')
    if (!res.ok) return null
    const { token } = await res.json()
    return token
  } catch {
    return null
  }
}

export function AdminSettings() {
  const [users, setUsers] = useState<BackendUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const token = await getToken()
    if (!token) { setError('Not authenticated'); setLoading(false); return }

    try {
      const res = await fetch(`${API_URL}/admin/users`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Failed: ${res.status}`)
      const data = await res.json()
      setUsers(data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  async function toggleRole(user: BackendUser) {
    const newRole = user.authRole === 'admin' ? 'user' : 'admin'
    setActionLoading(user.id)

    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')

      // 1. Update backend PostgreSQL
      const backendRes = await fetch(`${API_URL}/admin/users/${user.id}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ role: newRole }),
      })
      if (!backendRes.ok) throw new Error('Backend update failed')

      // 2. Sync to frontend SQLite (auth.db)
      const syncRes = await fetch('/api/admin/update-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, role: newRole }),
      })
      if (!syncRes.ok) {
        // Non-critical — backend is source of truth
        console.warn('Frontend SQLite sync failed (user may not exist locally)')
      }

      // 3. Refresh list
      await fetchUsers()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading users...</p>

  // Initial-load failure: nothing to show yet, so offer a Retry (mirrors marketplace/page.tsx).
  if (error && users.length === 0) {
    return (
      <div className="py-10 text-center space-y-3">
        <p className="text-destructive text-sm">Error: {error}</p>
        <Button variant="outline" size="sm" onClick={fetchUsers}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">User Management</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Promote users to admin or demote back to regular user. Admin users get free AI access.
        </p>
      </div>

      {/* Action failure (list is populated): show a dismissible banner, keep the list mounted. */}
      {error && (
        <div className="rounded-lg border border-destructive/50 p-3 text-sm flex items-center justify-between gap-3">
          <span className="text-destructive">Error: {error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}

      <div className="border rounded-lg divide-y">
        {users.map(user => (
          <div key={user.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="font-medium text-sm">{user.email}</p>
              <p className="text-xs text-muted-foreground">{user.name ?? 'No name'}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs px-2 py-1 rounded-full ${
                user.authRole === 'admin'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
              }`}>
                {user.authRole}
              </span>
              <Button
                size="sm"
                variant={user.authRole === 'admin' ? 'outline' : 'default'}
                disabled={actionLoading === user.id}
                onClick={() => toggleRole(user)}
              >
                {actionLoading === user.id
                  ? '...'
                  : user.authRole === 'admin' ? 'Demote' : 'Make Admin'}
              </Button>
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <p className="px-4 py-6 text-center text-muted-foreground text-sm">No users found</p>
        )}
      </div>
    </div>
  )
}

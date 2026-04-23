'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import TopBar from '@/components/layout/TopBar'

interface User {
  id: string
  email: string
  role: 'admin' | 'user'
  created_at: string
  created_by: string | null
}

export default function AdminPage() {
  const { data: session, status } = useSession()
  const myRole = (session?.user as { role?: string } | undefined)?.role

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user')
  const [submitting, setSubmitting] = useState(false)

  const [changingPw, setChangingPw] = useState<string | null>(null)
  const [pwValue, setPwValue] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/users')
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to load')
      } else {
        setUsers(data.users ?? [])
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (myRole === 'admin') load()
  }, [myRole])

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, password: newPassword, role: newRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to create')
      } else {
        setNewEmail('')
        setNewPassword('')
        setNewRole('user')
        setShowAdd(false)
        await load()
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(u: User) {
    if (!confirm(`Delete user "${u.email}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to delete')
      } else {
        await load()
      }
    } catch (err) {
      setError(String(err))
    }
  }

  async function handleRoleChange(u: User, role: 'admin' | 'user') {
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to update role')
      } else {
        await load()
      }
    } catch (err) {
      setError(String(err))
    }
  }

  async function handlePasswordChange(u: User) {
    if (!pwValue || pwValue.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to update password')
      } else {
        setChangingPw(null)
        setPwValue('')
        await load()
      }
    } catch (err) {
      setError(String(err))
    }
  }

  // Not admin — show denied state
  if (status === 'loading') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar title="Admin" />
        <div className="p-6 animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mb-4" />
          <div className="h-20 bg-gray-200 rounded-xl" />
        </div>
      </div>
    )
  }
  if (myRole !== 'admin') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar title="Admin" />
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div>
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 15v2m0 0v3m0-3h3m-3 0H9m12-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-base font-medium text-gray-700">Access restricted</p>
            <p className="text-sm text-gray-400 mt-1">Admin privileges required to access this page.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar title="Admin — Team" subtitle={`${users.length} user${users.length !== 1 ? 's' : ''}`} />
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl space-y-5">

        {/* Header actions */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Manage who can access Flow Monitor. Admins can add, delete, and change roles.
          </p>
          <button
            onClick={() => { setShowAdd(!showAdd); setError('') }}
            className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            {showAdd ? 'Cancel' : '+ Add user'}
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Add user form */}
        {showAdd && (
          <form onSubmit={handleAddUser} className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">New user</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  required
                  placeholder="teammate@particleformen.com"
                  className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Password (min 8 chars)</label>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="TempPass2026!"
                  className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}
                className="text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="user">User (view only)</option>
                <option value="admin">Admin (can manage users)</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md font-medium transition-colors"
              >
                {submitting ? 'Creating…' : 'Create user'}
              </button>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setError('') }}
                className="text-sm px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Users list */}
        {loading ? (
          <div className="animate-pulse space-y-2">
            {[0,1,2].map(i => <div key={i} className="h-16 bg-gray-200 rounded-xl" />)}
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No users yet</p>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {users.map((u) => {
              const isMe = u.email === session?.user?.email?.toLowerCase()
              return (
                <div key={u.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 truncate">{u.email}</p>
                      {isMe && (
                        <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">you</span>
                      )}
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        u.role === 'admin' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {u.role}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Added {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      {u.created_by && ` by ${u.created_by}`}
                    </p>

                    {changingPw === u.id && (
                      <div className="mt-2 flex gap-2">
                        <input
                          type="text"
                          value={pwValue}
                          onChange={(e) => setPwValue(e.target.value)}
                          placeholder="New password (min 8 chars)"
                          className="flex-1 text-sm border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <button
                          onClick={() => handlePasswordChange(u)}
                          className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => { setChangingPw(null); setPwValue(''); setError('') }}
                          className="text-xs px-3 py-1 bg-white border border-gray-200 text-gray-600 rounded-md"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {changingPw !== u.id && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => { setChangingPw(u.id); setPwValue(''); setError('') }}
                        className="text-xs px-2 py-1 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-md"
                      >
                        Reset pw
                      </button>
                      {!isMe && (
                        <>
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u, e.target.value as 'admin' | 'user')}
                            className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button
                            onClick={() => handleDelete(u)}
                            className="text-xs px-2 py-1 bg-white border border-red-200 hover:bg-red-50 text-red-600 rounded-md"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

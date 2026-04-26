'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props { params: { token: string } }

export default function InvitePage({ params }: Props) {
  const router = useRouter()
  const [loading, setLoading]   = useState(true)
  const [email, setEmail]       = useState('')
  const [role, setRole]         = useState<'admin' | 'user'>('user')
  const [pw, setPw]             = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/invites/${params.token}`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(data.error ?? 'Invalid invite')
        } else {
          setEmail(data.email)
          setRole(data.role)
        }
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [params.token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (pw.length < 8) { setError('Password must be at least 8 characters'); return }
    if (pw !== pwConfirm) { setError('Passwords do not match'); return }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/invites/${params.token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to set password')
      } else {
        setDone(true)
        setTimeout(() => router.push('/login'), 1500)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h1 className="text-lg font-semibold text-gray-900">Welcome to Flow Monitor</h1>
        <p className="text-sm text-gray-500 mt-1">Set your password to activate your account.</p>

        {loading ? (
          <div className="mt-6 animate-pulse space-y-3">
            <div className="h-4 bg-gray-200 rounded w-2/3" />
            <div className="h-10 bg-gray-200 rounded" />
            <div className="h-10 bg-gray-200 rounded" />
          </div>
        ) : error && !email ? (
          <div className="mt-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-3">
            {error}
            <p className="text-xs text-red-500 mt-2">Ask an admin for a new invite link.</p>
          </div>
        ) : done ? (
          <div className="mt-6 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-3 py-3">
            Account created. Redirecting to login…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Email</label>
              <input
                type="email"
                value={email}
                disabled
                className="w-full text-sm border border-gray-200 bg-gray-50 rounded-md px-3 py-2 text-gray-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Role</label>
              <input
                type="text"
                value={role}
                disabled
                className="w-full text-sm border border-gray-200 bg-gray-50 rounded-md px-3 py-2 text-gray-500 capitalize"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500">Password (min 8 chars)</label>
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
              <input
                type={showPw ? 'text' : 'password'}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                required
                minLength={8}
                autoFocus
                className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Confirm password</label>
              <input
                type={showPw ? 'text' : 'password'}
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
                required
                minLength={8}
                className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full text-sm px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md font-medium transition-colors"
            >
              {submitting ? 'Setting password…' : 'Activate account'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

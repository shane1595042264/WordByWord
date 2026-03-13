'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

interface CatalogEntry {
  id: string
  title: string
  author: string | null
  description: string | null
  coverUrl: string | null
  isbn: string | null
  language: string | null
  totalPages: number | null
  userCount: number
  metadataSource: string
  createdAt: string
}

export default function MarketplacePage() {
  const { data: session } = useSession()
  const router = useRouter()
  const isAdmin = (session?.user as any)?.role === 'admin'
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Redirect non-admins
  useEffect(() => {
    if (session && !isAdmin) {
      router.push('/')
    }
  }, [session, isAdmin, router])

  const fetchCatalog = useCallback(async () => {
    setLoading(true)
    try {
      const tokenRes = await fetch('/api/auth/token')
      if (!tokenRes.ok) return
      const { token } = await tokenRes.json()
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
      const searchParam = search ? `?search=${encodeURIComponent(search)}` : ''
      const res = await fetch(`${apiUrl}/admin/catalog${searchParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setCatalog(data.data || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    if (isAdmin) fetchCatalog()
  }, [isAdmin, fetchCatalog])

  const addToShelf = async (catalogId: string) => {
    setAdding(catalogId)
    setMessage(null)
    try {
      const tokenRes = await fetch('/api/auth/token')
      if (!tokenRes.ok) return
      const { token } = await tokenRes.json()
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
      const res = await fetch(`${apiUrl}/admin/catalog/${catalogId}/add-to-shelf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setMessage('Failed to add book')
        return
      }
      const data = await res.json()
      if (data.alreadyExists) {
        setMessage('Book already in your library')
      } else {
        setMessage('Book added to your library! Go to Settings > Cloud Sync > Download from Cloud to get it locally.')
      }
    } catch {
      setMessage('Failed to add book')
    } finally {
      setAdding(null)
    }
  }

  if (!isAdmin) {
    return <div className="flex justify-center py-20 text-muted-foreground">Admin access required</div>
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Link href="/" className="text-sm text-muted-foreground hover:underline mb-4 inline-block">
        &larr; Back to Library
      </Link>
      <h1 className="text-2xl font-bold mb-2">Marketplace</h1>
      <p className="text-muted-foreground mb-6">
        Archive of all books ever uploaded. Add any book to your shelf.
      </p>

      <div className="flex gap-2 mb-6">
        <Input
          placeholder="Search by title..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && fetchCatalog()}
        />
        <Button onClick={fetchCatalog}>Search</Button>
      </div>

      {message && (
        <div className="rounded-lg border p-3 mb-4 text-sm">{message}</div>
      )}

      {loading ? (
        <div className="text-muted-foreground py-10 text-center">Loading catalog...</div>
      ) : catalog.length === 0 ? (
        <div className="text-muted-foreground py-10 text-center">No books in catalog</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {catalog.map(entry => (
            <Card key={entry.id}>
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="aspect-[3/4] bg-muted rounded-md flex items-center justify-center overflow-hidden">
                  {entry.coverUrl ? (
                    <img src={entry.coverUrl} alt={entry.title} className="object-cover w-full h-full" />
                  ) : (
                    <span className="text-4xl text-muted-foreground">📖</span>
                  )}
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold text-sm line-clamp-2">{entry.title}</h3>
                  {entry.author && <p className="text-xs text-muted-foreground">{entry.author}</p>}
                  <div className="flex gap-2 text-xs text-muted-foreground">
                    {entry.totalPages && <span>{entry.totalPages} pages</span>}
                    <span>{entry.userCount} user(s)</span>
                  </div>
                  {entry.isbn && <p className="text-xs text-muted-foreground">ISBN: {entry.isbn}</p>}
                </div>
                <Button
                  size="sm"
                  onClick={() => addToShelf(entry.id)}
                  disabled={adding === entry.id}
                >
                  {adding === entry.id ? 'Adding...' : 'Add to My Shelf'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

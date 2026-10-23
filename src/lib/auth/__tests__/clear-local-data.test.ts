import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db/database'
import type { Book } from '@/lib/db/models'
import { clearLocalUserData, ensureLocalDataOwner, LOCAL_OWNER_KEY } from '../clear-local-data'
import { SettingsService } from '@/lib/services/settings-service'

function seedBook(id: string) {
  return db.books.add({
    id,
    title: `Book ${id}`,
    author: 'A',
    totalPages: 1,
    coverImage: null,
    structureSource: 'native',
    processingStatus: 'complete',
    createdAt: 1,
    updatedAt: 1,
  } as Book)
}

describe('ensureLocalDataOwner (KAN-351)', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.books.clear()
  })

  it('wipes the previous owner\'s library and sync cursors when a different user signs in', async () => {
    localStorage.setItem(LOCAL_OWNER_KEY, 'user-a')
    localStorage.setItem('nibble_lastPushedAt', '123')
    await seedBook('a-book')

    await ensureLocalDataOwner('user-b')

    expect(await db.books.count()).toBe(0)
    expect(localStorage.getItem('nibble_lastPushedAt')).toBeNull()
    expect(localStorage.getItem(LOCAL_OWNER_KEY)).toBe('user-b')
  })

  it('leaves the same user\'s local-only books alone on reload', async () => {
    localStorage.setItem(LOCAL_OWNER_KEY, 'user-a')
    localStorage.setItem('nibble_lastPushedAt', '123')
    await seedBook('a-book')

    await ensureLocalDataOwner('user-a')

    expect(await db.books.count()).toBe(1)
    expect(localStorage.getItem('nibble_lastPushedAt')).toBe('123')
  })

  it('claims data with no recorded owner instead of wiping it', async () => {
    await seedBook('legacy-book')

    await ensureLocalDataOwner('user-a')

    expect(await db.books.count()).toBe(1)
    expect(localStorage.getItem(LOCAL_OWNER_KEY)).toBe('user-a')
  })

  it('an owner change drops the previous user\'s settings and API key instead of pushing them (KAN-364)', async () => {
    localStorage.setItem(LOCAL_OWNER_KEY, 'user-a')
    const svc = new SettingsService()
    svc.updateSettings({ targetLanguage: 'ja', anthropicApiKey: 'sk-user-a' })
    svc.markSettingsSynced(svc.getSettingsUpdatedAt())

    await ensureLocalDataOwner('user-b')

    expect(localStorage.getItem('bbb-settings')).toBeNull()
    expect(svc.hasPendingSettingsPush()).toBe(false)
    expect(svc.getApiKey()).toBeNull()
  })

  it('sign-out leaves no settings for the next user to push or inherit (KAN-364)', async () => {
    const svc = new SettingsService()
    svc.updateSettings({ keymapOverrides: { 'normal:j': 'x' }, anthropicApiKey: 'sk-user-a' })
    svc.markSettingsSynced(svc.getSettingsUpdatedAt())

    await clearLocalUserData()

    expect(svc.hasPendingSettingsPush()).toBe(false)
    expect(svc.getApiKey()).toBeNull()
    expect(svc.getSettings().keymapOverrides).toEqual({})
  })

  it('sign-out clears the owner so the next user claims an empty DB', async () => {
    localStorage.setItem(LOCAL_OWNER_KEY, 'user-a')
    await seedBook('a-book')

    await clearLocalUserData()

    expect(await db.books.count()).toBe(0)
    expect(localStorage.getItem(LOCAL_OWNER_KEY)).toBeNull()
  })
})

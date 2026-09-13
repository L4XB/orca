import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'

const { getSshFilesystemProviderMock, getEffectiveHooksMock } = vi.hoisted(() => ({
  getSshFilesystemProviderMock: vi.fn(),
  getEffectiveHooksMock: vi.fn()
}))
vi.mock('../../../providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: getSshFilesystemProviderMock
}))
vi.mock('../../../hooks', () => ({ getEffectiveHooks: getEffectiveHooksMock }))

import { getArchiveHooksForRemoval } from './worktree-archive-hook'

const REMOTE_REPO: Repo = {
  id: 'r',
  path: '/home/orca/repo',
  displayName: 'r',
  badgeColor: '#000',
  addedAt: 0
}

// Why (#19334): a worktree row can name its owner only as `executionHostId: 'ssh:<target>'`, leaving
// `repo.connectionId` null. Resolving hooks off the row alone then reads THIS machine's disk for a
// repo that lives on an SSH host — the committed archive hook goes unseen and the removal proceeds
// as though none were configured, which is the bug the gate exists to stop.
describe('getArchiveHooksForRemoval owner resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSshFilesystemProviderMock.mockReturnValue(undefined)
    getEffectiveHooksMock.mockReturnValue(null)
  })

  it('asks the execution host when only the route knows the connection', async () => {
    await getArchiveHooksForRemoval(REMOTE_REPO, 'ssh-target')

    expect(getSshFilesystemProviderMock).toHaveBeenCalledWith('ssh-target')
    // The local reader must never answer for a repo that lives on another host.
    expect(getEffectiveHooksMock).not.toHaveBeenCalled()
  })

  it('falls back to the repo row when the caller names no owner', async () => {
    await getArchiveHooksForRemoval({ ...REMOTE_REPO, connectionId: 'row-connection' })

    expect(getSshFilesystemProviderMock).toHaveBeenCalledWith('row-connection')
    expect(getEffectiveHooksMock).not.toHaveBeenCalled()
  })

  it('reads locally only when neither names a connection', async () => {
    await getArchiveHooksForRemoval({ ...REMOTE_REPO, path: '/local/repo' })

    expect(getSshFilesystemProviderMock).not.toHaveBeenCalled()
    expect(getEffectiveHooksMock).toHaveBeenCalled()
  })
})

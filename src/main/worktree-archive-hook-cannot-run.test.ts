import { describe, expect, it, vi } from 'vitest'
import type { Repo } from '../shared/repo-types'
import { gateRemovalWhereArchiveHookCannotRun } from './worktree-archive-hook-gate'

// Mocked at the SSH-aware reader, because that is the whole point: on an SSH worktree the hook
// lives on the execution host, not on the runtime's local disk.
const { getArchiveHooksForRemovalMock } = vi.hoisted(() => ({
  getArchiveHooksForRemovalMock: vi.fn()
}))
vi.mock('./ipc/worktrees/removal/worktree-archive-hook', () => ({
  getArchiveHooksForRemoval: getArchiveHooksForRemovalMock
}))

const REPO: Repo = { id: 'r', path: '/repo', displayName: 'r', badgeColor: '#000', addedAt: 0 }
const withArchiveHook = (present: boolean): void => {
  getArchiveHooksForRemovalMock.mockResolvedValue({
    hooks: present ? { scripts: { archive: 'archive.sh' } } : null,
    hookConfigUnreadable: false
  })
}
import {
  ARCHIVE_HOOK_FAILED_REMOVAL_CODE,
  asArchiveHookRefusal
} from '../shared/worktree/archive-hook-removal-gate'

// Why (#19334 / S1): the runtime's SSH path runs no archive hook. Silently deleting there would
// reproduce the reported bug in the one place `worktree.archive-failure-blocking.v1` promises it
// cannot happen, so the capability would be advertising a guarantee it does not keep.
describe('gateRemovalWhereArchiveHookCannotRun', () => {
  it('lets a repo with no archive hook through untouched', async () => {
    withArchiveHook(false)
    await expect(
      gateRemovalWhereArchiveHookCannotRun({
        repo: REPO,
        connectionId: undefined,
        worktreePath: '/w/f',
        runHooks: true
      })
    ).resolves.toBeUndefined()
  })

  it('warns rather than refuses when hooks were not requested', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    withArchiveHook(true)
    await expect(
      gateRemovalWhereArchiveHookCannotRun({
        repo: REPO,
        connectionId: undefined,
        worktreePath: '/w/f',
        runHooks: false
      })
    ).resolves.toContain('pass --run-hooks to run it')
  })

  // Pins the reader itself: `getEffectiveHooks` resolves orca.yaml against the RUNTIME's disk, so
  // on an SSH worktree — where repo.path names a path on the execution host — it would miss the
  // committed hook this gate exists for, and could refuse on a coincidental local one.
  it('asks the execution host whether a hook exists, not the local disk', async () => {
    withArchiveHook(false)
    await gateRemovalWhereArchiveHookCannotRun({
      repo: REPO,
      connectionId: 'ssh-target',
      worktreePath: '/w/f',
      runHooks: true
    })
    // Why the connectionId matters: `repo.connectionId` is null for a row that names its owner
    // only as `executionHostId: 'ssh:<target>'`, and reading local disk there would miss the
    // committed hook entirely — the exact silent skip this gate exists to stop.
    expect(getArchiveHooksForRemovalMock).toHaveBeenCalledWith(REPO, 'ssh-target')
  })

  it('refuses a hooks-requested removal it cannot honour, as unverifiable', async () => {
    withArchiveHook(true)
    const thrown = await gateRemovalWhereArchiveHookCannotRun({
      repo: REPO,
      connectionId: undefined,
      worktreePath: '/w/f',
      runHooks: true
    }).catch((error: unknown) => error)
    const refusal = asArchiveHookRefusal(thrown)
    expect(refusal.code).toBe(ARCHIVE_HOOK_FAILED_REMOVAL_CODE)
    // Never `exited`: nothing ran, so nothing reported an exit to read.
    expect(refusal.data).toMatchObject({ worktreePath: '/w/f', outcome: 'unverifiable' })
    expect(refusal.data.exitCode).toBeUndefined()
  })
})

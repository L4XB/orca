import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Repo } from '../shared/repo-types'

vi.mock('./effective-hook-config', () => ({
  getEffectiveHooksFromConfig: (_repo: unknown, hooks: unknown) => hooks
}))

const REPO: Repo = { id: 'r', path: '/repo', displayName: 'r', badgeColor: '#000', addedAt: 0 }

// Why its own file: hooks that outlive their deadline in a sibling test leave a pending SIGKILL
// escalation, and this test measures exactly that traffic. Isolation is the assertion's premise.
//
// Why (#19334): the escalation fires seconds after SIGTERM. `terminateHookTree` signals a process
// GROUP by negative pid, so if the hook exited in that window and the OS recycled its pid, the
// SIGKILL would land on whatever now owns that group. An exited child is never signalled.
describe.skipIf(process.platform === 'win32')('archive hook termination safety', () => {
  it('does not signal a hook that stopped on its own after the deadline', async () => {
    const { runHook } = await import('./hooks')
    const dir = mkdtempSync(join(tmpdir(), 'orca-hook-exit-'))
    writeFileSync(join(dir, 'orca.yaml'), 'scripts:\n  archive: |\n    sleep 0.4\n')
    const killSpy = vi.spyOn(process, 'kill')
    try {
      // The deadline lands first; the hook then finishes on its own, well before the escalation.
      const result = await runHook('archive', dir, REPO, dir, undefined, 100)
      expect(result.success).toBe(false)
      await new Promise((resolve) => setTimeout(resolve, 2_600))

      const groupKills = killSpy.mock.calls.filter(
        ([pid, signal]) => typeof pid === 'number' && pid < 0 && signal === 'SIGKILL'
      )
      expect(groupKills).toEqual([])
    } finally {
      killSpy.mockRestore()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

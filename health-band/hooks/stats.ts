import type { HealthStats, JobCount } from '../types'

export const LSE_YELLOW = 10000
export const LSE_RED = 14000

const LABELS: Record<string, string> = { codex: 'Codex', cline: 'Cline', opencode: 'opencode', amp: 'Amp', atlarix: 'Atlarix', copilot: 'Copilot' }

export function lseText(lse: HealthStats['lse']): string {
  return lse ? `LSE ${lse.count}/${lse.limit}` : 'LSE unavailable'
}

export function lseColor(lse: HealthStats['lse']): 'red' | 'yellow' | undefined {
  if (!lse) return undefined
  return lse.count > LSE_RED ? 'red' : lse.count > LSE_YELLOW ? 'yellow' : undefined
}

export function jobsText(jobs: JobCount[] | null): string {
  if (!jobs) return 'agent jobs unavailable'
  const parts = jobs.flatMap(j => {
    const states = (['ok', 'running', 'failed'] as const).filter(k => j[k] > 0).map(k => `${k} ${j[k]}`)
    return states.length ? [`${LABELS[j.agent] ?? j.agent} ${states.join(' ')}`] : []
  })
  return parts.length ? parts.join(' · ') : 'no agent jobs today'
}

export function overheadText(tokens: number | null): string {
  if (tokens === null) return 'overhead unavailable'
  const n = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
  return `overhead ~${n} tok/turn`
}

export type CqWithheld = { path: string; reason: string }
export type CqGroup = {
  id: string
  group: string
  repo: string
  repo_name: string
  branch: string | null
  file_count: number
  allowed_count: number
  added: number
  deleted: number
  withheld: CqWithheld[]
  hash: string
}
export type CqIdentity = { name: string; email: string; source: 'repo' | 'config' }
export type CqRepo = {
  repo: string
  name: string
  branch: string | null
  readable: boolean
  error: string | null
  truncated: boolean
  identity: CqIdentity | null
  groups: CqGroup[]
}
export type CqScan = {
  ok: true
  interval_min: number
  totals: { files: number; groups: number; repos: number; unreadable: number }
  repos: CqRepo[]
}
/** What the band draws: the last scan, or why it failed. */
export type CqReport = { scan: CqScan; error: null } | { scan: null; error: string }
export type CqCommitResult = {
  ok: boolean
  error?: string
  sha?: string
  author?: string
  email?: string
  files?: number
  has_trailer?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'commit-queue': { report: CqReport | null }
  }
}

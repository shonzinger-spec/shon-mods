export const CONVO_WORDS = 25
export const ACTION = /\b(build|make|create|add|write|implement|fix|refactor|set ?up|install|deploy|generate|design|develop|migrate|convert|scrape|automate|integrate|update|change|rename|delete|remove|move|test|backtest|publish|ship|draft|research|find|analy[sz]e|compare|audit|run|schedule|connect)\b/i
export type Skip = 'command' | 'attachment' | 'short' | 'chat' | null

/**
 * Decide whether a prompt should skip brief expansion.
 * Order: /^(--|\/)/ -> 'command'; any attachment of type 'image' or 'document' -> 'attachment';
 * word count (whitespace split) < 15 -> 'short'; word count < CONVO_WORDS and no ACTION match -> 'chat';
 * otherwise null. Audio attachments do not skip.
 */
export function skipReason(text: string, attachments?: readonly { type: string }[]): Skip {
  if (/^(--|\/)/.test(text)) return 'command'
  if (attachments?.some(a => a.type === 'image' || a.type === 'document')) return 'attachment'
  const words = text.split(/\s+/).filter(Boolean).length
  if (words < 15) return 'short'
  if (words < CONVO_WORDS && !ACTION.test(text)) return 'chat'
  return null
}

/**
 * Pure helpers for automatic memory and long-chat summaries.
 * Kept free of app imports so they can be unit tested.
 */

export type TranscriptLine = {
    id: number
    isUser: boolean
    name: string
    text: string
    tokens: number
}

export type SideMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export const MAX_MEMORY_LENGTH = 200
export const MAX_NEW_MEMORIES_PER_RUN = 5
/** user messages needed before a chat is scanned for new memories */
export const MEMORY_SCAN_EVERY_USER_MESSAGES = 6
/** fraction of the context window kept for recent messages when deciding what to summarise */
export const RECENT_WINDOW_FRACTION = 0.5
/** the summary prompt (transcript + previous summary) may use this fraction of the context */
export const SUMMARY_INPUT_FRACTION = 0.6
export const MIN_ENTRIES_TO_SUMMARISE = 4

/** Rough token estimate used when the real count is not stored yet */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5)

const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi
const UNCLOSED_THINK = /<think>[\s\S]*$/i

export const stripThinking = (text: string) =>
    text.replace(THINK_BLOCK, '').replace(UNCLOSED_THINK, '').trim()

const clip = (text: string, maxChars: number) =>
    text.length > maxChars ? text.slice(0, maxChars).trimEnd() + ' […]' : text

export const formatTranscript = (lines: TranscriptLine[], maxCharsPerLine: number) =>
    lines
        .map(
            (line) =>
                `${line.isUser ? 'User' : 'Assistant'}: ${clip(line.text.trim(), maxCharsPerLine)}`
        )
        .join('\n\n')

// ---------- memory ----------

export const buildMemoryBlock = (facts: string[]) =>
    facts.length === 0
        ? ''
        : 'Things you remember about the user from earlier conversations ' +
          '(use them when relevant, do not list them unprompted):\n' +
          facts.map((fact) => `- ${fact}`).join('\n')

export const buildMemoryExtractionMessages = (
    existing: string[],
    lines: TranscriptLine[]
): SideMessage[] => [
    {
        role: 'system',
        content:
            'You maintain a short list of long-term facts about the user of a chat assistant. ' +
            'Only record durable facts the user stated about themselves: name, job, ongoing projects, ' +
            'preferences for how answers should be written, important people, tools they use. ' +
            'Never record passwords, card or account numbers, health details, or anything said about ' +
            'other people that the user would not want stored. Never guess.',
    },
    {
        role: 'user',
        content:
            (existing.length
                ? 'Already known (do not repeat these):\n' +
                  existing.map((fact) => `- ${fact}`).join('\n') +
                  '\n\n'
                : '') +
            'Conversation:\n' +
            formatTranscript(lines, 800) +
            '\n\nWrite each NEW fact on its own line starting with "- ", in third person ' +
            '(e.g. "- Works as a nurse"). If there is nothing new worth remembering, reply with NONE.',
    },
]

const normalise = (text: string) =>
    text
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

export const parseExtractedFacts = (output: string, existing: string[]): string[] => {
    const cleaned = stripThinking(output)
    if (/^\s*none\b/i.test(cleaned)) return []
    const seen = new Set(existing.map(normalise))
    const facts: string[] = []
    for (const raw of cleaned.split('\n')) {
        const match = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/)
        if (!match) continue
        const fact = match[1].trim().replace(/^["']|["']$/g, '')
        const key = normalise(fact)
        if (!key || key === 'none' || fact.length > MAX_MEMORY_LENGTH || seen.has(key)) continue
        seen.add(key)
        facts.push(fact)
        if (facts.length >= MAX_NEW_MEMORIES_PER_RUN) break
    }
    return facts
}

/** Lines the memory scan should look at, or [] if it is not time yet. */
export const selectLinesForMemoryScan = (lines: TranscriptLine[], scannedUntilId: number) => {
    const fresh = lines.filter((line) => line.id > scannedUntilId)
    const userCount = fresh.filter((line) => line.isUser).length
    if (userCount < MEMORY_SCAN_EVERY_USER_MESSAGES) return []
    return fresh
}

// ---------- summaries ----------

export const buildSummaryBlock = (summary: string) =>
    summary ? 'Summary of the earlier part of this conversation:\n' + summary : ''

/**
 * Picks the oldest messages that will not fit in the context window any more and are not yet in
 * the summary. The newest messages that fill RECENT_WINDOW_FRACTION of the window are left alone.
 */
export const selectLinesToSummarise = (
    lines: TranscriptLine[],
    contextLength: number,
    summarisedUntilId: number
): TranscriptLine[] => {
    const recentBudget = contextLength * RECENT_WINDOW_FRACTION
    let used = 0
    let firstRecentIndex = lines.length
    for (let i = lines.length - 1; i >= 0; i--) {
        used += lines[i].tokens
        if (used > recentBudget) break
        firstRecentIndex = i
    }
    const candidates = lines
        .slice(0, firstRecentIndex)
        .filter((line) => line.id > summarisedUntilId)
    if (candidates.length < MIN_ENTRIES_TO_SUMMARISE) return []

    // only take as much as one summary prompt can hold, oldest first; later runs catch up
    const inputBudget = contextLength * SUMMARY_INPUT_FRACTION
    const batch: TranscriptLine[] = []
    let batchTokens = 0
    for (const line of candidates) {
        const cost = Math.min(line.tokens, estimateTokens('x'.repeat(1500)))
        if (batch.length > 0 && batchTokens + cost > inputBudget) break
        batch.push(line)
        batchTokens += cost
    }
    return batch
}

export const buildSummaryMessages = (
    previousSummary: string,
    lines: TranscriptLine[]
): SideMessage[] => [
    {
        role: 'system',
        content:
            'You write compact running summaries of conversations so they can continue after older ' +
            "messages are forgotten. Keep names, decisions, facts, open questions and the user's goals. " +
            'Leave out small talk. Write plain sentences, no headings.',
    },
    {
        role: 'user',
        content:
            (previousSummary ? 'Summary so far:\n' + previousSummary + '\n\n' : '') +
            'Next part of the conversation:\n' +
            formatTranscript(lines, 1500) +
            '\n\nWrite the updated summary of the whole conversation so far in at most 200 words.',
    },
]

export const cleanSummary = (output: string) => {
    const text = stripThinking(output)
        .replace(/^(updated )?summary:\s*/i, '')
        .trim()
    return text.length > 2500 ? text.slice(0, 2500) : text
}

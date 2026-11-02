import {
    buildMemoryBlock,
    cleanSummary,
    MEMORY_SCAN_EVERY_USER_MESSAGES,
    parseExtractedFacts,
    selectLinesForMemoryScan,
    selectLinesToSummarise,
    stripThinking,
    TranscriptLine,
} from '../lib/engine/Memory/MemoryPrompts'

const line = (id: number, isUser: boolean, tokens = 100): TranscriptLine => ({
    id,
    isUser,
    name: isUser ? 'User' : 'Assistant',
    text: `message ${id}`,
    tokens,
})

describe('parseExtractedFacts', () => {
    it('reads bullet lines and skips known facts', () => {
        const output = '- Works as a nurse\n- Has a dog called Max\n* works as a nurse\nfiller'
        expect(parseExtractedFacts(output, ['Has a dog called Max'])).toEqual(['Works as a nurse'])
    })

    it('returns nothing for NONE and ignores thinking', () => {
        expect(parseExtractedFacts('<think>- secret</think>NONE', [])).toEqual([])
        expect(parseExtractedFacts('<think>hmm</think>\n1. Likes tea', [])).toEqual(['Likes tea'])
    })

    it('limits the number and length of facts', () => {
        const many = Array.from({ length: 10 }, (_, i) => `- fact number ${i}`).join('\n')
        expect(parseExtractedFacts(many, [])).toHaveLength(5)
        expect(parseExtractedFacts('- ' + 'a'.repeat(300), [])).toEqual([])
    })
})

describe('selectLinesForMemoryScan', () => {
    it('waits for enough new user messages', () => {
        const lines = Array.from({ length: 6 }, (_, i) => line(i + 1, i % 2 === 0))
        expect(selectLinesForMemoryScan(lines, 0)).toEqual([])
        const more = Array.from({ length: MEMORY_SCAN_EVERY_USER_MESSAGES * 2 }, (_, i) =>
            line(i + 1, i % 2 === 0)
        )
        expect(selectLinesForMemoryScan(more, 0)).toHaveLength(more.length)
        expect(selectLinesForMemoryScan(more, more.length)).toEqual([])
    })
})

describe('selectLinesToSummarise', () => {
    it('does nothing while the chat fits', () => {
        const lines = Array.from({ length: 10 }, (_, i) => line(i + 1, i % 2 === 0, 100))
        expect(selectLinesToSummarise(lines, 4096, 0)).toEqual([])
    })

    it('summarises the oldest messages outside the recent window', () => {
        const lines = Array.from({ length: 60 }, (_, i) => line(i + 1, i % 2 === 0, 100))
        const picked = selectLinesToSummarise(lines, 4096, 0)
        expect(picked.length).toBeGreaterThanOrEqual(4)
        expect(picked[0].id).toBe(1)
        // the newest half of the window is never summarised
        expect(Math.max(...picked.map((l) => l.id))).toBeLessThanOrEqual(60 - 20)
    })

    it('continues after what is already summarised', () => {
        const lines = Array.from({ length: 60 }, (_, i) => line(i + 1, i % 2 === 0, 100))
        const picked = selectLinesToSummarise(lines, 4096, 30)
        expect(picked[0].id).toBe(31)
    })
})

describe('text helpers', () => {
    it('strips thinking, including unfinished blocks', () => {
        expect(stripThinking('<think>a</think>Hello')).toBe('Hello')
        expect(stripThinking('Hi <think>never closed')).toBe('Hi')
    })

    it('cleans summary prefixes', () => {
        expect(cleanSummary('Summary: They planned a trip.')).toBe('They planned a trip.')
    })

    it('builds an empty memory block when nothing is known', () => {
        expect(buildMemoryBlock([])).toBe('')
        expect(buildMemoryBlock(['Likes tea'])).toContain('- Likes tea')
    })
})

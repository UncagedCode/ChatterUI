import { formatDocumentsForContext, normaliseDocumentText } from '../lib/utils/DocumentText'

describe('normaliseDocumentText', () => {
    it('normalises line endings and blank runs', () => {
        expect(normaliseDocumentText('a\r\nb  \r\n\n\n\n\n\nc\u0000')).toBe('a\nb\n\n\nc')
    })
})

describe('formatDocumentsForContext', () => {
    it('includes small documents whole', () => {
        const out = formatDocumentsForContext([{ name: 'notes.txt', text: 'hello' }], 4096)
        expect(out).toContain('[Attached file: notes.txt]\nhello')
        expect(out).not.toContain('Only the first')
    })

    it('cuts large documents to fit and says so', () => {
        const text = 'x'.repeat(50_000)
        const out = formatDocumentsForContext([{ name: 'big.pdf', text }], 4096)
        expect(out.length).toBeLessThan(4096 * 0.5 * 3.5 + 300)
        expect(out).toContain('Only the first')
    })

    it('shares the budget between documents', () => {
        const text = 'y'.repeat(20_000)
        const out = formatDocumentsForContext(
            [
                { name: 'a.txt', text },
                { name: 'b.txt', text },
            ],
            4096
        )
        expect(out).toContain('[Attached file: a.txt]')
        expect(out).toContain('[Attached file: b.txt]')
    })

    it('returns nothing without documents', () => {
        expect(formatDocumentsForContext([], 4096)).toBe('')
    })
})

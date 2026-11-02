/** Pure helpers for document attachments (unit tested). */

/** stored text is capped so a huge file cannot fill the phone or freeze the chat */
export const DOCUMENT_MAX_STORED_CHARS = 400_000
/** at most this share of the context window goes to the documents of one message */
export const DOCUMENT_CONTEXT_SHARE = 0.35
const CHARS_PER_TOKEN = 3.5

export const normaliseDocumentText = (text: string) =>
    text
        .replace(/\r\n?/g, '\n')
        .replace(/\u0000/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim()

export type DocumentForContext = { name: string; text: string }

/**
 * Formats a message's documents for the prompt, cutting them down to fit the context window.
 * Each document gets an equal share; anything cut is marked so the model knows.
 */
export const formatDocumentsForContext = (
    documents: DocumentForContext[],
    tokenBudget: number
): string => {
    if (documents.length === 0 || tokenBudget <= 0) return ''
    const totalChars = Math.floor(tokenBudget * CHARS_PER_TOKEN)
    const perDocument = Math.max(Math.floor(totalChars / documents.length), 200)
    return documents
        .map(({ name, text }) => {
            const cut = text.length > perDocument
            const body = cut ? text.slice(0, perDocument).trimEnd() : text
            const note = cut
                ? `\n[Only the first ${Math.round((perDocument / text.length) * 100)}% of this file fits in the model's memory]`
                : ''
            return `\n\n[Attached file: ${name}]\n${body}${note}\n[End of file: ${name}]`
        })
        .join('')
}

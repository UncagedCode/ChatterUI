import { getDocumentAsync } from 'expo-document-picker'
import { File, Paths } from 'expo-file-system'

import { extractPdfText } from '../../modules/pdf-text'
import { DOCUMENT_MAX_STORED_CHARS, normaliseDocumentText } from './DocumentText'

export type DocumentAttachment = {
    uri: string // plain text file holding the extracted text
    name: string // original file name, shown to the user and the model
    type: 'document'
}

export type DocumentPickError = 'too_large' | 'no_text' | 'password' | 'unreadable'

const MAX_FILE_BYTES = 25 * 1024 * 1024

const PICKABLE_TYPES = [
    'application/pdf',
    'text/*',
    'application/json',
    'application/xml',
    'application/x-yaml',
    'application/javascript',
    'application/x-sh',
    'application/sql',
]

const isPdf = (name: string, mimeType?: string) =>
    mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')

const readDocumentText = async (uri: string, name: string, mimeType?: string) => {
    if (isPdf(name, mimeType)) {
        const result = await extractPdfText(uri)
        return result.text
    }
    return await new File(uri).text()
}

/**
 * Lets the user pick text files or PDFs and turns each into a plain-text attachment.
 * Text is extracted on the device; nothing is uploaded.
 */
export const pickDocuments = async (): Promise<{
    documents: DocumentAttachment[]
    errors: { name: string; error: DocumentPickError }[]
}> => {
    const picked = await getDocumentAsync({
        type: PICKABLE_TYPES,
        multiple: true,
        copyToCacheDirectory: true,
    })
    if (picked.canceled) return { documents: [], errors: [] }

    const documents: DocumentAttachment[] = []
    const errors: { name: string; error: DocumentPickError }[] = []

    for (const asset of picked.assets) {
        const name = asset.name ?? 'document'
        if ((asset.size ?? 0) > MAX_FILE_BYTES) {
            errors.push({ name, error: 'too_large' })
            continue
        }
        try {
            const raw = await readDocumentText(asset.uri, name, asset.mimeType)
            const text = normaliseDocumentText(raw).slice(0, DOCUMENT_MAX_STORED_CHARS)
            if (!text.trim()) {
                errors.push({ name, error: 'no_text' })
                continue
            }
            const file = new File(Paths.cache, `doc-${Date.now()}-${documents.length}.txt`)
            file.write(text)
            documents.push({ uri: file.uri, name, type: 'document' })
        } catch (e) {
            const message = `${e}`
            errors.push({ name, error: message.includes('PDF_PASSWORD') ? 'password' : 'unreadable' })
        }
    }
    return { documents, errors }
}

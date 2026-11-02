import { requireOptionalNativeModule } from 'expo'

type PdfTextResult = { text: string; pages: number; pagesRead: number }

type PdfTextModule = {
    extractText: (uri: string, maxPages: number) => Promise<PdfTextResult>
}

// Optional so the app still starts if the native part is missing from a build
const PdfText = requireOptionalNativeModule<PdfTextModule>('PdfText')

export const isPdfSupported = () => PdfText !== null

export const extractPdfText = async (uri: string, maxPages: number = 200) => {
    if (!PdfText) throw new Error('PDF_UNSUPPORTED')
    return await PdfText.extractText(uri, maxPages)
}

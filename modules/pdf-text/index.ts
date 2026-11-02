import { requireNativeModule } from 'expo'

type PdfTextResult = { text: string; pages: number; pagesRead: number }

type PdfTextModule = {
    extractText: (uri: string, maxPages: number) => Promise<PdfTextResult>
}

const PdfText = requireNativeModule<PdfTextModule>('PdfText')

export const extractPdfText = (uri: string, maxPages: number = 200) =>
    PdfText.extractText(uri, maxPages)

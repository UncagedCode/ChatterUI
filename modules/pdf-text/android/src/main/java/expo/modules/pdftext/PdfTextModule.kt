package expo.modules.pdftext

import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.text.PDFTextStripper
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.FileInputStream
import java.io.InputStream

class PdfPasswordException : CodedException("PDF_PASSWORD", "This PDF is password protected", null)
class PdfReadException(cause: Throwable) : CodedException("PDF_READ", "Could not read this PDF", cause)

class PdfTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfText")

    // Reads the text layer of a PDF entirely on the device. Scanned pages without text return "".
    AsyncFunction("extractText") { uri: String, maxPages: Int ->
      val context = appContext.reactContext ?: throw PdfReadException(IllegalStateException("No context"))
      PDFBoxResourceLoader.init(context)

      val parsed = Uri.parse(uri)
      val stream: InputStream = when (parsed.scheme) {
        "content" -> context.contentResolver.openInputStream(parsed)
          ?: throw PdfReadException(IllegalStateException("Cannot open $uri"))
        "file" -> FileInputStream(parsed.path)
        else -> FileInputStream(uri)
      }

      try {
        stream.use { input ->
          PDDocument.load(input).use { document ->
            val pages = document.numberOfPages
            val stripper = PDFTextStripper()
            stripper.sortByPosition = true
            stripper.startPage = 1
            stripper.endPage = minOf(pages, maxOf(maxPages, 1))
            mapOf(
              "text" to stripper.getText(document),
              "pages" to pages,
              "pagesRead" to stripper.endPage
            )
          }
        }
      } catch (e: InvalidPasswordException) {
        throw PdfPasswordException()
      } catch (e: CodedException) {
        throw e
      } catch (e: Throwable) {
        throw PdfReadException(e)
      }
    }
  }
}

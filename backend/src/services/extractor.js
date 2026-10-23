import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import path from 'path';

/**
 * Extracts plain text from PDF, DOCX, and TXT files.
 */
export async function extractTextFromBuffer(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();

  try {
    switch (ext) {
      case '.pdf': {
        const data = await pdfParse(buffer);
        return {
          text: data.text.trim(),
          numPages: data.numpages,
          info: data.info
        };
      }

      case '.docx': {
        const result = await mammoth.extractRawText({ buffer });
        return {
          text: result.value.trim(),
          warnings: result.messages
        };
      }

      case '.txt':
      case '.md':
      case '.json':
      case '.csv': {
        const text = buffer.toString('utf-8').trim();
        return { text };
      }

      default:
        throw new Error(`Unsupported file extension "${ext}". Supported types: .pdf, .docx, .txt, .md`);
    }
  } catch (err) {
    throw new Error(`Text extraction failed for ${filename}: ${err.message}`);
  }
}

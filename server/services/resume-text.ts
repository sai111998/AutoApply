import mammoth from 'mammoth'
import { extractText, getDocumentProxy } from 'unpdf'
import { HttpError } from '../types'

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

function normalizeExtractedText(value: string): string {
  return value.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim()
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const extracted = await extractText(pdf, { mergePages: true })
  const text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
  return normalizeExtractedText(text)
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer })
  return normalizeExtractedText(result.value)
}

export async function extractResumeText(fileName: string, buffer: Buffer): Promise<string> {
  if (!buffer.length) {
    throw new HttpError(400, 'Resume file is empty.')
  }

  const extension = extensionOf(fileName)
  if (extension === 'txt') {
    return normalizeExtractedText(buffer.toString('utf8'))
  }
  if (extension === 'pdf') {
    try {
      const text = await extractPdf(buffer)
      if (!text) {
        throw new HttpError(422, 'No text could be extracted from this PDF. Upload a text-based PDF or a .txt resume.')
      }
      return text
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(422, 'Could not read text from this PDF. Upload a text-based PDF or a .txt resume.')
    }
  }
  if (extension === 'docx') {
    try {
      const text = await extractDocx(buffer)
      if (!text) {
        throw new HttpError(422, 'No text could be extracted from this Word file. Upload a .txt resume instead.')
      }
      return text
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(422, 'Could not read text from this Word file. Upload a .txt resume instead.')
    }
  }

  throw new HttpError(400, 'Upload a PDF, DOCX, or TXT resume.')
}

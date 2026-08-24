import { HttpError } from '../types'
import type { TailoredResume } from './types'

type PdfDocumentCtor = new (options?: Record<string, unknown>) => {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  on(event: 'end', listener: () => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  font(name: string): PdfKitDoc
  fontSize(size: number): PdfKitDoc
  fillColor(color: string): PdfKitDoc
  text(value: string, options?: Record<string, unknown>): PdfKitDoc
  moveDown(lines?: number): PdfKitDoc
  moveTo(x: number, y: number): PdfKitDoc
  lineTo(x: number, y: number): PdfKitDoc
  strokeColor(color: string): PdfKitDoc
  lineWidth(width: number): PdfKitDoc
  stroke(): PdfKitDoc
  addPage(): PdfKitDoc
  end(): void
  y: number
  page: { height: number; width: number; margins: { left: number; right: number; bottom: number } }
}

type PdfKitDoc = InstanceType<PdfDocumentCtor>

async function loadPdfDocument(): Promise<PdfDocumentCtor> {
  try {
    const loaded = (await import('pdfkit')) as unknown as { default: PdfDocumentCtor }
    if (typeof loaded.default !== 'function') {
      throw new Error('pdfkit export missing')
    }
    return loaded.default
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(
      503,
      'PDF generation is unavailable. Run npm install in the project root, then restart the server.',
    )
  }
}

export async function renderResumePdf(resume: TailoredResume): Promise<Buffer> {
  const PDFDocument = await loadPdfDocument()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 54,
      info: {
        Title: `${resume.contact.name || 'Resume'}`,
        Author: resume.contact.name || 'JobPilot AI',
      },
    })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const name = resume.contact.name || 'Resume'
    doc.font('Times-Bold').fontSize(20).fillColor('#1e221c').text(name, { align: 'center' })
    const contact = [resume.contact.email, resume.contact.location].filter(Boolean).join('  ·  ')
    if (contact) {
      doc.moveDown(0.25)
      doc.font('Times-Roman').fontSize(10).fillColor('#5d6359').text(contact, { align: 'center' })
    }

    const section = (title: string) => {
      ensureSpace(72)
      doc.moveDown(0.8)
      doc.font('Times-Bold').fontSize(12).fillColor('#1e221c').text(title.toUpperCase())
      doc.moveTo(doc.page.margins.left, doc.y + 2)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
        .strokeColor('#e2dfd6')
        .lineWidth(0.8)
        .stroke()
      doc.moveDown(0.45)
    }

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
        doc.addPage()
      }
    }

    if (resume.summary) {
      section('Summary')
      doc.font('Times-Roman').fontSize(10.5).fillColor('#1e221c').text(resume.summary, { align: 'left', lineGap: 2 })
    }

    if (resume.skills.length) {
      section('Skills')
      doc.font('Times-Roman').fontSize(10.5).fillColor('#1e221c').text(resume.skills.join('  ·  '), { lineGap: 2 })
    }

    if (resume.experience.length) {
      section('Experience')
      for (const role of resume.experience) {
        ensureSpace(84)
        doc.font('Times-Bold').fontSize(11).fillColor('#1e221c').text(role.title || role.company, {
          continued: Boolean(role.dates),
        })
        if (role.dates) {
          doc.font('Times-Roman').fontSize(10).fillColor('#5d6359').text(role.dates, { align: 'right' })
        } else {
          doc.text('')
        }
        if (role.company) {
          doc.font('Times-Italic').fontSize(10.5).fillColor('#1e221c').text(role.company)
        }
        doc.moveDown(0.15)
        for (const bullet of role.bullets) {
          ensureSpace(28)
          doc.font('Times-Roman').fontSize(10.5).fillColor('#1e221c').text(`•  ${bullet}`, {
            indent: 12,
            lineGap: 1.5,
          })
        }
        doc.moveDown(0.35)
      }
    }

    if (resume.projects.length) {
      section('Projects')
      for (const project of resume.projects) {
        ensureSpace(48)
        doc.font('Times-Bold').fontSize(11).fillColor('#1e221c').text(project.name)
        for (const bullet of project.bullets) {
          doc.font('Times-Roman').fontSize(10.5).text(`•  ${bullet}`, { indent: 12 })
        }
      }
    }

    if (resume.education.length) {
      section('Education')
      for (const item of resume.education) {
        const line = [item.degree, item.field].filter(Boolean).join(', ')
        doc.font('Times-Bold').fontSize(11).fillColor('#1e221c').text(line || item.details)
        if (item.details && line) {
          doc.font('Times-Roman').fontSize(10.5).text(item.details)
        }
      }
    }

    if (resume.certifications.length) {
      section('Certifications')
      doc.font('Times-Roman').fontSize(10.5).fillColor('#1e221c').text(resume.certifications.join('  ·  '))
    }

    doc.end()
  })
}

export function isPdfBuffer(value: Buffer): boolean {
  return value.subarray(0, 5).toString('utf8') === '%PDF-'
}

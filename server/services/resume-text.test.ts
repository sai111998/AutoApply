import { describe, expect, it } from 'vitest'
import { extractResumeText } from './resume-text'
import { HttpError } from '../types'

const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 51 >>
stream
BT /F1 24 Tf 72 720 Td (Hello Resume Text) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000369 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
452
%%EOF
`

describe('extractResumeText', () => {
  it('reads plain text resumes', async () => {
    const text = await extractResumeText('resume.txt', Buffer.from('Java and Spring Boot engineer', 'utf8'))
    expect(text).toBe('Java and Spring Boot engineer')
  })

  it('reads text from a simple PDF', async () => {
    const text = await extractResumeText('resume.pdf', Buffer.from(MINIMAL_PDF, 'utf8'))
    expect(text).toMatch(/Hello Resume Text/)
  })

  it('rejects unsupported file types', async () => {
    await expect(extractResumeText('photo.png', Buffer.from('abc'))).rejects.toBeInstanceOf(HttpError)
  })
})

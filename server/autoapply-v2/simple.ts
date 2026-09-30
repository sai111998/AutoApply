import { classifyV2Field, type V2FieldDescriptor, type V2FieldMapping } from './fields'
import { unsupportedV2System } from './system'

export type V2UnsupportedReason =
  | 'WORKDAY'
  | 'EXTERNAL_PORTAL'
  | 'COVER_LETTER_REQUIRED'
  | 'ASSESSMENT_REQUIRED'
  | 'LONG_FORM_QUESTIONS'
  | 'LARGE_QUESTIONNAIRE'
  | 'BASIC_FIELDS_NOT_FOUND'
  | 'SUBMIT_BUTTON_NOT_FOUND'
  | 'RESUME_UPLOAD_UNAVAILABLE'

export type V2FormClassification =
  | { classification: 'SUPPORTED_SIMPLE' }
  | { classification: 'UNSUPPORTED_COMPLEX'; reason: V2UnsupportedReason; detail: string }

// More required questions than this, none answerable from the profile, is a questionnaire rather than a simple form.
const MAX_UNANSWERED_REQUIRED = 5

function labelOf(field: V2FieldDescriptor): string {
  return (field.label || field.placeholder || field.name || field.type).replace(/[*✱]/g, '').replace(/\s+/g, ' ').trim()
}

function unsupported(reason: V2UnsupportedReason, detail: string): V2FormClassification {
  return { classification: 'UNSUPPORTED_COMPLEX', reason, detail }
}

export function classifyV2ApplicationForm(input: {
  url: string
  fields: V2FieldDescriptor[]
  mapping: V2FieldMapping
  hasSubmit: boolean
  hasNext: boolean
  firstFormPage: boolean
  resumeUploaded: boolean
}): V2FormClassification {
  const system = unsupportedV2System(input.url)
  if (system) return unsupported(system.reason, system.detail)

  const required = input.fields.filter((field) => field.required)
  const coverLetter = required.find((field) => /cover[\s_-]*letter/i.test(`${field.label} ${field.name}`))
  if (coverLetter) return unsupported('COVER_LETTER_REQUIRED', `A cover letter is required ("${labelOf(coverLetter)}").`)
  const assessment = required.find((field) =>
    /assessment|coding (challenge|exercise|test)|take[- ]home|hackerrank|codility|testgorilla/i.test(labelOf(field)),
  )
  if (assessment) return unsupported('ASSESSMENT_REQUIRED', `An assessment is required before submitting ("${labelOf(assessment)}").`)
  const essay = required.find((field) => field.tag === 'textarea' && !field.value.trim() && classifyV2Field(field) === null)
  if (essay) return unsupported('LONG_FORM_QUESTIONS', `A required written answer is needed ("${labelOf(essay)}").`)
  if (input.mapping.unknownRequired.length > MAX_UNANSWERED_REQUIRED) {
    return unsupported(
      'LARGE_QUESTIONNAIRE',
      `${input.mapping.unknownRequired.length} required questions cannot be answered from the profile.`,
    )
  }

  const keys = new Set(input.mapping.detected.map((field) => field.key))
  const hasName = keys.has('fullName') || (keys.has('firstName') && keys.has('lastName'))
  if (input.firstFormPage && !(hasName && keys.has('email'))) {
    return unsupported('BASIC_FIELDS_NOT_FOUND', 'The form has no name and email fields to fill.')
  }
  if (!input.hasSubmit && !input.hasNext) {
    return unsupported('SUBMIT_BUTTON_NOT_FOUND', 'The form has no Submit application or Next control.')
  }
  if (input.hasSubmit && !input.hasNext && !input.resumeUploaded && !keys.has('resume')) {
    return unsupported('RESUME_UPLOAD_UNAVAILABLE', 'The form has no resume or CV upload.')
  }
  return { classification: 'SUPPORTED_SIMPLE' }
}

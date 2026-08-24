import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { TextArea, TextInput } from '@/components/ui/Field'
import type { TailoredResumeContent } from '@/types/domain'

export function ResumeEditor({
  resume,
  onChange,
}: {
  resume: TailoredResumeContent
  onChange: (next: TailoredResumeContent) => void
}) {
  return (
    <Card className="p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-olive">Editing tailored resume</p>
      <p className="mt-1 text-sm text-muted">
        Changes apply only to this tailored version. The master resume stays as it is.
      </p>

      <div className="mt-5 space-y-6">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-charcoal">Professional summary</span>
          <TextArea rows={4} value={resume.summary} onChange={(e) => onChange({ ...resume, summary: e.target.value })} />
        </label>

        <div>
          <p className="mb-2 text-sm font-medium text-charcoal">Skills</p>
          <div className="flex flex-wrap gap-2">
            {resume.skills.map((skill, index) => (
              <span
                key={`${skill}-${index}`}
                className="inline-flex items-center gap-1 rounded-full border border-olive-border bg-olive-soft px-3 py-1 text-sm text-olive-dark"
              >
                <input
                  className="w-28 bg-transparent outline-none"
                  value={skill}
                  onChange={(e) => {
                    const skills = resume.skills.map((item, itemIndex) => (itemIndex === index ? e.target.value : item))
                    onChange({ ...resume, skills })
                  }}
                />
                <button
                  type="button"
                  className="text-muted hover:text-danger"
                  onClick={() => onChange({ ...resume, skills: resume.skills.filter((_, itemIndex) => itemIndex !== index) })}
                  aria-label={`Remove ${skill || 'skill'}`}
                >
                  ×
                </button>
              </span>
            ))}
            <Button type="button" variant="ghost" onClick={() => onChange({ ...resume, skills: [...resume.skills, ''] })}>
              <Plus size={14} />
              Add skill
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-charcoal">Experience</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                onChange({
                  ...resume,
                  experience: [...resume.experience, { company: '', title: '', dates: '', bullets: [''] }],
                })
              }
            >
              <Plus size={14} />
              Add role
            </Button>
          </div>
          <div className="space-y-4">
            {resume.experience.map((role, roleIndex) => (
              <div key={`${role.company}-${roleIndex}`} className="rounded-2xl border border-line p-4">
                <div className="mb-3 flex justify-end">
                  <button
                    type="button"
                    className="text-xs font-semibold text-muted hover:text-danger"
                    onClick={() =>
                      onChange({
                        ...resume,
                        experience: resume.experience.filter((_, itemIndex) => itemIndex !== roleIndex),
                      })
                    }
                  >
                    Remove role
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <TextInput
                    value={role.title}
                    onChange={(e) => updateRole(resume, onChange, roleIndex, { title: e.target.value })}
                    placeholder="Title"
                  />
                  <TextInput
                    value={role.company}
                    onChange={(e) => updateRole(resume, onChange, roleIndex, { company: e.target.value })}
                    placeholder="Company"
                  />
                  <TextInput
                    value={role.dates}
                    onChange={(e) => updateRole(resume, onChange, roleIndex, { dates: e.target.value })}
                    placeholder="Dates"
                  />
                </div>
                <ul className="mt-3 space-y-2">
                  {role.bullets.map((bullet, bulletIndex) => (
                    <li key={`${roleIndex}-${bulletIndex}`} className="flex gap-2">
                      <TextArea
                        rows={2}
                        className="min-h-0"
                        value={bullet}
                        onChange={(e) => {
                          const bullets = role.bullets.map((item, itemIndex) =>
                            itemIndex === bulletIndex ? e.target.value : item,
                          )
                          updateRole(resume, onChange, roleIndex, { bullets })
                        }}
                      />
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          className="text-muted hover:text-olive disabled:opacity-30"
                          disabled={bulletIndex === 0}
                          onClick={() => moveBullet(resume, onChange, roleIndex, bulletIndex, -1)}
                          aria-label="Move bullet up"
                        >
                          <ChevronUp size={16} />
                        </button>
                        <button
                          type="button"
                          className="text-muted hover:text-olive disabled:opacity-30"
                          disabled={bulletIndex === role.bullets.length - 1}
                          onClick={() => moveBullet(resume, onChange, roleIndex, bulletIndex, 1)}
                          aria-label="Move bullet down"
                        >
                          <ChevronDown size={16} />
                        </button>
                        <button
                          type="button"
                          className="text-muted hover:text-danger"
                          onClick={() => {
                            const bullets = role.bullets.filter((_, itemIndex) => itemIndex !== bulletIndex)
                            updateRole(resume, onChange, roleIndex, { bullets })
                          }}
                          aria-label="Remove bullet"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => updateRole(resume, onChange, roleIndex, { bullets: [...role.bullets, ''] })}
                >
                  <Plus size={14} />
                  Add bullet
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-charcoal">Projects</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onChange({ ...resume, projects: [...resume.projects, { name: '', bullets: [''] }] })}
            >
              <Plus size={14} />
              Add project
            </Button>
          </div>
          {resume.projects.map((project, index) => (
            <div key={`${project.name}-${index}`} className="mb-3 rounded-2xl border border-line p-4">
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  className="text-xs font-semibold text-muted hover:text-danger"
                  onClick={() =>
                    onChange({
                      ...resume,
                      projects: resume.projects.filter((_, itemIndex) => itemIndex !== index),
                    })
                  }
                >
                  Remove project
                </button>
              </div>
              <TextInput
                value={project.name}
                onChange={(e) => {
                  const projects = resume.projects.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: e.target.value } : item,
                  )
                  onChange({ ...resume, projects })
                }}
                placeholder="Project name"
              />
              <TextArea
                className="mt-2 min-h-0"
                rows={3}
                value={project.bullets.join('\n')}
                onChange={(e) => {
                  const projects = resume.projects.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, bullets: e.target.value.split('\n') } : item,
                  )
                  onChange({ ...resume, projects })
                }}
                placeholder="One bullet per line"
              />
            </div>
          ))}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-charcoal">Education</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                onChange({
                  ...resume,
                  education: [...resume.education, { degree: '', field: '', details: '' }],
                })
              }
            >
              <Plus size={14} />
              Add education
            </Button>
          </div>
          {resume.education.map((item, index) => (
            <div key={`${item.degree}-${index}`} className="mb-3 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
              <TextInput
                value={item.degree}
                placeholder="Degree"
                onChange={(e) => {
                  const education = resume.education.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, degree: e.target.value } : row,
                  )
                  onChange({ ...resume, education })
                }}
              />
              <TextInput
                value={item.field}
                placeholder="Field"
                onChange={(e) => {
                  const education = resume.education.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, field: e.target.value } : row,
                  )
                  onChange({ ...resume, education })
                }}
              />
              <TextInput
                value={item.details}
                placeholder="Details"
                onChange={(e) => {
                  const education = resume.education.map((row, rowIndex) =>
                    rowIndex === index ? { ...row, details: e.target.value } : row,
                  )
                  onChange({ ...resume, education })
                }}
              />
              <button
                type="button"
                className="text-muted hover:text-danger"
                onClick={() =>
                  onChange({
                    ...resume,
                    education: resume.education.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
                aria-label="Remove education"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-charcoal">Certifications</span>
          <TextInput
            value={resume.certifications.join(', ')}
            onChange={(e) =>
              onChange({
                ...resume,
                certifications: e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
              })
            }
            placeholder="Comma-separated"
          />
        </label>
      </div>
    </Card>
  )
}

function updateRole(
  resume: TailoredResumeContent,
  onChange: (next: TailoredResumeContent) => void,
  index: number,
  patch: Partial<TailoredResumeContent['experience'][number]>,
) {
  const experience = resume.experience.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
  onChange({ ...resume, experience })
}

function moveBullet(
  resume: TailoredResumeContent,
  onChange: (next: TailoredResumeContent) => void,
  roleIndex: number,
  bulletIndex: number,
  direction: -1 | 1,
) {
  const role = resume.experience[roleIndex]
  const nextIndex = bulletIndex + direction
  if (!role || nextIndex < 0 || nextIndex >= role.bullets.length) return
  const bullets = [...role.bullets]
  const [moved] = bullets.splice(bulletIndex, 1)
  bullets.splice(nextIndex, 0, moved)
  updateRole(resume, onChange, roleIndex, { bullets })
}

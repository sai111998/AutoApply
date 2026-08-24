import { Card } from '@/components/ui/Card'
import type { TailoredResumeContent } from '@/types/domain'

export function ResumeDocument({
  title,
  resume,
  muted,
  highlight,
  changedSections = [],
}: {
  title: string
  resume: TailoredResumeContent
  muted?: boolean
  highlight?: boolean
  changedSections?: string[]
}) {
  const changed = new Set(changedSections)
  return (
    <Card className={`p-6 ${highlight ? 'ring-1 ring-olive-border' : ''}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-olive">{title}</p>
      <div className={`mt-4 space-y-4 ${muted ? 'text-muted' : 'text-charcoal'}`}>
        <div>
          <p className="font-display text-2xl text-charcoal">{resume.contact.name || 'Resume'}</p>
          <p className="text-sm">
            {[resume.contact.email, resume.contact.location].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Section title="Summary" body={resume.summary} marked={changed.has('summary')} />
        <Section title="Skills" body={resume.skills.join(' · ')} marked={changed.has('skills')} />
        <div className={changed.has('experience') ? 'rounded-2xl bg-olive-soft/60 px-3 py-2' : ''}>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Experience</p>
          {resume.experience.map((role) => (
            <div key={`${role.company}-${role.dates}-${role.title}`} className="mt-3">
              <p className="font-semibold text-charcoal">
                {role.title} · {role.company}
              </p>
              <p className="text-xs text-muted">{role.dates}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {role.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <Section
          title="Education"
          body={resume.education.map((item) => [item.degree, item.field, item.details].filter(Boolean).join(', ')).join('\n')}
        />
        {resume.projects.length > 0 && (
          <Section title="Projects" body={resume.projects.map((item) => item.name).join(' · ')} />
        )}
        {resume.certifications.length > 0 && <Section title="Certifications" body={resume.certifications.join(' · ')} />}
      </div>
    </Card>
  )
}

function Section({ title, body, marked }: { title: string; body: string; marked?: boolean }) {
  if (!body) return null
  return (
    <div className={marked ? 'rounded-2xl bg-olive-soft/60 px-3 py-2' : ''}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{title}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{body}</p>
    </div>
  )
}

import { FormEvent, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, Select, TextInput } from '@/components/ui/Field'
import { Pill } from '@/components/ui/Badge'
import { useWorkspace } from '@/context/WorkspaceContext'
import { createId, formatSalary } from '@/lib/format'
import type { Profile, Skill, SkillProficiency, WorkArrangement, WorkAuthorization } from '@/types/domain'
import { PROFICIENCY_LABELS, WORK_ARRANGEMENT_LABELS, WORK_AUTHORIZATION_LABELS } from '@/types/domain'

export function ProfilePage() {
  const { profile, skills, saveProfile } = useWorkspace()
  const [form, setForm] = useState<Profile>(profile)
  const [skillList, setSkillList] = useState<Skill[]>(skills)
  const [newSkill, setNewSkill] = useState('')
  const [newProficiency, setNewProficiency] = useState<SkillProficiency>('advanced')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const titlesValue = useMemo(() => form.targetJobTitles.join(', '), [form.targetJobTitles])

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function addSkill() {
    const name = newSkill.trim()
    if (!name) return
    setSkillList((current) => [
      ...current,
      { id: createId(), userId: profile.id, name, proficiency: newProficiency, yearsExperience: 0 },
    ])
    setNewSkill('')
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await saveProfile(form, skillList)
      setMessage('Profile saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Candidate"
        title="My Profile"
        description="This profile is sent to the analysis API with each job description. Keep titles, location, and authorization current."
      />
      <form className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]" onSubmit={(event) => void onSubmit(event)}>
        <Card className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label="Name">
            <TextInput value={form.fullName} onChange={(e) => update('fullName', e.target.value)} />
          </Field>
          <Field label="Email">
            <TextInput type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
          </Field>
          <Field label="Location">
            <TextInput value={form.location} onChange={(e) => update('location', e.target.value)} />
          </Field>
          <Field label="Years of experience">
            <TextInput
              type="number"
              min={0}
              value={form.yearsOfExperience}
              onChange={(e) => update('yearsOfExperience', Number(e.target.value))}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Target job titles (comma separated)">
              <TextInput
                value={titlesValue}
                onChange={(e) =>
                  update(
                    'targetJobTitles',
                    e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                  )
                }
              />
            </Field>
          </div>
          <Field label="Work authorization">
            <Select
              value={form.workAuthorization}
              onChange={(e) => update('workAuthorization', e.target.value as WorkAuthorization)}
            >
              {Object.entries(WORK_AUTHORIZATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sponsorship requirement">
            <Select
              value={form.sponsorshipRequired ? 'yes' : 'no'}
              onChange={(e) => update('sponsorshipRequired', e.target.value === 'yes')}
            >
              <option value="no">Does not require sponsorship</option>
              <option value="yes">Requires employer sponsorship</option>
            </Select>
          </Field>
          <Field label="Preferred work arrangement">
            <Select
              value={form.preferredWorkArrangement}
              onChange={(e) => update('preferredWorkArrangement', e.target.value as WorkArrangement)}
            >
              {Object.entries(WORK_ARRANGEMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Target salary min">
              <TextInput
                type="number"
                value={form.targetSalaryMin}
                onChange={(e) => update('targetSalaryMin', Number(e.target.value))}
              />
            </Field>
            <Field label="Target salary max">
              <TextInput
                type="number"
                value={form.targetSalaryMax}
                onChange={(e) => update('targetSalaryMax', Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="sm:col-span-2 flex items-center justify-between pt-2">
            <p className="text-sm text-slate-ink">
              Range: {formatSalary(form.targetSalaryMin || 0, form.targetSalaryMax || 0)}
            </p>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
          {message && <p className="sm:col-span-2 text-sm text-pine">{message}</p>}
          {error && <p className="sm:col-span-2 text-sm text-clay">{error}</p>}
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-2xl text-navy">Skills</h2>
          <p className="mt-1 text-sm text-slate-ink">Used later by the analysis API as candidate skill context.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {skillList.map((skill) => (
              <span key={skill.id} className="inline-flex items-center gap-2 rounded-full bg-fog px-3 py-1.5 text-sm">
                {skill.name}
                <span className="text-xs text-slate-ink">{PROFICIENCY_LABELS[skill.proficiency]}</span>
                <button
                  type="button"
                  aria-label={`Remove ${skill.name}`}
                  onClick={() => setSkillList((current) => current.filter((item) => item.id !== skill.id))}
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-5 grid gap-3">
            <Field label="Add a skill">
              <TextInput value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="PostgreSQL" />
            </Field>
            <Field label="Proficiency">
              <Select value={newProficiency} onChange={(e) => setNewProficiency(e.target.value as SkillProficiency)}>
                {Object.entries(PROFICIENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="button" variant="secondary" onClick={addSkill}>
              Add skill
            </Button>
          </div>
          <div className="mt-6 rounded-2xl bg-paper p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-ink">Authorization snapshot</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill tone="info">{WORK_AUTHORIZATION_LABELS[form.workAuthorization]}</Pill>
              <Pill tone={form.sponsorshipRequired ? 'review' : 'strong'}>
                {form.sponsorshipRequired ? 'Needs sponsorship' : 'No sponsorship'}
              </Pill>
              <Pill>{WORK_ARRANGEMENT_LABELS[form.preferredWorkArrangement]}</Pill>
            </div>
          </div>
        </Card>
      </form>
    </div>
  )
}

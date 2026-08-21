import { FormEvent, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { Field, Select, TextArea, TextInput } from '@/components/ui/Field'
import { useWorkspace } from '@/context/WorkspaceContext'
import { getJobAnalysisClient } from '@/lib/ai/client'
import type { UserPreferences, WorkArrangement } from '@/types/domain'
import { WORK_ARRANGEMENT_LABELS } from '@/types/domain'

export function SettingsPage() {
  const { preferences, savePreferences } = useWorkspace()
  const [form, setForm] = useState<UserPreferences>(preferences)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const aiConfigured = getJobAnalysisClient().isConfigured()

  function update<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      await savePreferences(form)
      setMessage('Preferences saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save preferences')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="AI routing, target roles, locations, and application habits. These values travel with each analysis request."
      />

      <form className="grid gap-6 lg:grid-cols-2" onSubmit={(event) => void onSubmit(event)}>
        <Card className="p-6">
          <h2 className="font-display text-2xl text-navy">AI preferences</h2>
          <div className="mt-4 space-y-4">
            <Field label="Preferred model (passed to the API)">
              <TextInput
                value={form.aiModelPreference}
                onChange={(e) => update('aiModelPreference', e.target.value)}
                placeholder="Use the server default"
              />
            </Field>
            <Field label="Minimum match score">
              <TextInput
                type="number"
                min={0}
                max={100}
                value={form.minMatchScore}
                onChange={(e) => update('minMatchScore', Number(e.target.value))}
              />
            </Field>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={form.notifyOnStrongMatch}
                onChange={(e) => update('notifyOnStrongMatch', e.target.checked)}
              />
              Highlight roles at or above the minimum score
            </label>
            <p className={`rounded-xl px-3 py-2 text-sm ${aiConfigured ? 'bg-emerald-50 text-pine' : 'bg-paper text-slate-ink'}`}>
              {aiConfigured
                ? `Analysis endpoint: ${import.meta.env.VITE_AI_API_URL}/v1/analyze`
                : 'VITE_AI_API_URL is not set. Analyses remain queued until a backend is connected.'}
            </p>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-display text-2xl text-navy">Target roles & locations</h2>
          <div className="mt-4 space-y-4">
            <Field label="Target roles (comma separated)">
              <TextArea
                className="min-h-24"
                value={form.targetRoles.join(', ')}
                onChange={(e) =>
                  update(
                    'targetRoles',
                    e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                  )
                }
              />
            </Field>
            <Field label="Locations (comma separated)">
              <TextArea
                className="min-h-24"
                value={form.targetLocations.join(', ')}
                onChange={(e) =>
                  update(
                    'targetLocations',
                    e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                  )
                }
              />
            </Field>
          </div>
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h2 className="font-display text-2xl text-navy">Application preferences</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Preferred work arrangements">
              <Select
                multiple
                className="min-h-32"
                value={form.preferredWorkArrangements}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions).map((option) => option.value as WorkArrangement)
                  update('preferredWorkArrangements', values)
                }}
              >
                {Object.entries(WORK_ARRANGEMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="space-y-4">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={form.includeCoverLetter}
                  onChange={(e) => update('includeCoverLetter', e.target.checked)}
                />
                Prepare a cover letter when an application is marked ready
              </label>
              <p className="rounded-2xl bg-paper p-4 text-sm text-slate-ink">
                Automatic job submission and browser automation are not part of this MVP. Preferences here shape how
                you prepare materials, not how they are sent.
              </p>
            </div>
          </div>
          <div className="mt-6 flex items-center gap-4">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
            {message && <p className="text-sm text-pine">{message}</p>}
            {error && <p className="text-sm text-clay">{error}</p>}
          </div>
        </Card>
      </form>
    </div>
  )
}

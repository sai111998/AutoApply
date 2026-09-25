export type CheckboxSelectionState = 'none' | 'some' | 'all'

export function checkboxSelectionState(selectedIds: string[], visibleIds: string[]): CheckboxSelectionState {
  if (!visibleIds.length || !selectedIds.length) return 'none'
  const visible = new Set(visibleIds)
  const selectedVisible = selectedIds.filter((id) => visible.has(id))
  if (!selectedVisible.length) return 'none'
  if (selectedVisible.length === visibleIds.length) return 'all'
  return 'some'
}

export function toggleId(selectedIds: string[], id: string): string[] {
  return selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]
}

export function applySelectAll(visibleIds: string[], currentlyAll: boolean): string[] {
  return currentlyAll ? [] : [...visibleIds]
}

export function pruneSelection(selectedIds: string[], visibleIds: string[]): string[] {
  const visible = new Set(visibleIds)
  return selectedIds.filter((id) => visible.has(id))
}

export function deletedApplicationsMessage(count: number): string {
  if (count === 1) return 'Application deleted.'
  return `${count} applications deleted.`
}

export function bulkDeleteTitle(count: number): string {
  return count === 1 ? 'Delete 1 application?' : `Delete ${count} applications?`
}

export function bulkDeleteBody(count: number): string {
  return count === 1
    ? 'This will permanently remove the selected application record.'
    : 'This will permanently remove the selected application records.'
}

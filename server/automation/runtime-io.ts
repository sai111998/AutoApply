import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let testRuntimeDir: string | null = null
let testPersist = false

export function useAutomationRuntimeForTests(directory: string | null) {
  testRuntimeDir = directory
  testPersist = Boolean(directory)
}

export function automationRuntimeDir(): string {
  if (testRuntimeDir) return testRuntimeDir
  const configured = process.env.JOBPILOT_RUNTIME_DIR?.trim()
  if (configured) return path.resolve(configured)
  return path.join(os.tmpdir(), 'jobpilot-automation')
}

export function shouldPersistAutomationFiles(): boolean {
  if (testPersist) return true
  return process.env.VITEST !== 'true'
}

export function runtimeFilePath(fileName: string): string {
  return path.join(automationRuntimeDir(), fileName)
}

export function readRuntimeJson<T>(fileName: string): T | null {
  if (!shouldPersistAutomationFiles()) return null
  try {
    const file = runtimeFilePath(fileName)
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function writeRuntimeJson(fileName: string, value: unknown): void {
  if (!shouldPersistAutomationFiles()) return
  const directory = automationRuntimeDir()
  mkdirSync(directory, { recursive: true })
  const file = runtimeFilePath(fileName)
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value))
  renameSync(tmp, file)
}

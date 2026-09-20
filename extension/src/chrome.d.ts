declare const chrome: {
  runtime: {
    id?: string
    lastError?: { message?: string }
    sendMessage: (message: unknown, responseCallback?: (response: unknown) => void) => void
    onMessage: {
      addListener: (
        callback: (
          message: unknown,
          sender: { tab?: { id?: number }; url?: string },
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ) => void
    }
    onMessageExternal: {
      addListener: (
        callback: (
          message: unknown,
          sender: { id?: string; url?: string },
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ) => void
    }
  }
  storage?: {
    local: {
      get: (keys: string[] | string, callback: (value: Record<string, unknown>) => void) => void
      set: (value: Record<string, unknown>, callback?: () => void) => void
    }
  }
  tabs?: {
    create: (
      options: { url: string; active?: boolean },
      callback?: (tab: { id?: number; url?: string }) => void,
    ) => void
    query: (
      query: { active?: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean },
      callback: (tabs: Array<{ id?: number; url?: string; title?: string }>) => void,
    ) => void
    get: (tabId: number, callback: (tab?: { id?: number; url?: string; title?: string }) => void) => void
    sendMessage: (tabId: number, message: unknown, responseCallback?: (response: unknown) => void) => void
    onUpdated: {
      addListener: (callback: (tabId: number, info: { status?: string; url?: string }) => void) => void
      removeListener: (callback: (tabId: number, info: { status?: string; url?: string }) => void) => void
    }
  }
  scripting?: {
    executeScript: (
      options: { target: { tabId: number }; files?: string[]; func?: () => unknown },
    ) => Promise<Array<{ result?: unknown }>>
  }
  permissions?: {
    request: (options: { origins?: string[] }, callback?: (granted: boolean) => void) => void
    contains: (options: { origins?: string[] }, callback?: (result: boolean) => void) => void
  }
  alarms?: {
    create: (name: string, info: { periodInMinutes?: number }) => void
    onAlarm: { addListener: (callback: (alarm: { name: string }) => void) => void }
  }
}

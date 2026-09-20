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
    query: (
      query: { active?: boolean; currentWindow?: boolean },
      callback: (tabs: Array<{ id?: number; url?: string; title?: string }>) => void,
    ) => void
    sendMessage: (tabId: number, message: unknown, responseCallback?: (response: unknown) => void) => void
  }
  scripting?: {
    executeScript: (options: { target: { tabId: number }; files?: string[] }) => Promise<unknown>
  }
}

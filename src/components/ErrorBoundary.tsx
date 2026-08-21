import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  message: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null }

  static getDerivedStateFromError(error: Error): State {
    return { message: error.message || 'Something went wrong.' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info)
  }

  render() {
    if (this.state.message) {
      return (
        <div className="grid min-h-screen place-items-center bg-paper px-6 text-center">
          <div className="max-w-md">
            <h1 className="text-3xl font-semibold tracking-tight text-charcoal">JobPilot hit a snag</h1>
            <p className="mt-3 text-muted">{this.state.message}</p>
            <button
              type="button"
              className="mt-6 rounded-xl bg-olive px-4 py-2.5 text-sm font-semibold text-white"
              onClick={() => this.setState({ message: null })}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

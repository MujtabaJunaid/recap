import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Without this, any render-time throw unmounts the whole tree and leaves a blank page
 * with the cause only visible in the console.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Transcript content is user data and must not be shipped to a logger. Only the
    // error itself and the component stack go out.
    console.error('Render failed', error.message, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-white">Something broke on this page</h1>
          <p className="mt-1.5 text-sm text-ink-400">
            The rest of the app is still fine. Reloading usually clears it.
          </p>
          <p className="mt-3 rounded-lg border border-ink-800 bg-ink-900 p-2.5 text-left font-mono text-[11px] text-ink-400">
            {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-brand-500 px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-600"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}

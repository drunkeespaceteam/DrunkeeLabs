import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-slate-400 max-w-lg text-center mb-6">
            The UI crashed. Open the browser developer console (F12) for details, or refresh the page.
          </p>
          <pre className="text-xs bg-slate-900 border border-white/10 rounded-lg p-4 max-w-full overflow-auto text-rose-300 mb-6">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium"
          >
            Reload page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

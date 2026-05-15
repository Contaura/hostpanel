import { Component, ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; error?: Error }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-8 bg-slate-50 dark:bg-slate-900">
          <div className="max-w-md text-center space-y-4">
            <p className="text-5xl font-black text-slate-200 dark:text-slate-700">!</p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Something went wrong</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-mono break-all">{this.state.error?.message}</p>
            <button
              className="btn-primary"
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import React from 'react';

// Top-level error boundary. Catches render-time crashes anywhere in the app and
// shows a friendly recovery card instead of a blank white screen. A reload
// almost always clears a transient render error.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Surface in the console for debugging; no remote logging to keep it simple.
    console.error('App error boundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const reload = () => window.location.reload();
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-gray-900">
        <div className="w-full max-w-sm text-center bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6">
          <div className="text-4xl mb-3">🎻</div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Something needs a moment</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            The app hit a snag rendering this screen. A quick reload usually sorts it out.
          </p>
          <button
            type="button"
            onClick={reload}
            className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

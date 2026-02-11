'use client'

import * as Sentry from '@sentry/nextjs'

export default function SentryTestPage() {
  const testClientError = () => {
    throw new Error('Test Client-Side Error - Sentry is working!')
  }

  const testCapturedError = () => {
    try {
      throw new Error('Test Captured Error')
    } catch (error) {
      Sentry.captureException(error)
      alert('Error captured and sent to Sentry! Check your dashboard.')
    }
  }

  const testConsoleError = () => {
    console.error('Test Console Error', {
      timestamp: new Date().toISOString(),
      browser: typeof window !== 'undefined' ? window.navigator.userAgent : 'unknown'
    })
    alert('Console error logged. Check Sentry for breadcrumbs.')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-2xl p-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            🎯 Sentry Test Page
          </h1>
          <p className="text-gray-600 mb-8">
            Test your Sentry integration with the buttons below
          </p>

          <div className="space-y-4">
            {/* Client Error Test */}
            <div className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                1. Uncaught Client Error
              </h2>
              <p className="text-gray-600 mb-4">
                Throws an uncaught error that will be automatically captured by Sentry
              </p>
              <button
                onClick={testClientError}
                className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg transition-colors"
              >
                ⚠️ Throw Error
              </button>
            </div>

            {/* Captured Error Test */}
            <div className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                2. Manually Captured Error
              </h2>
              <p className="text-gray-600 mb-4">
                Catches an error and manually sends it to Sentry using captureException()
              </p>
              <button
                onClick={testCapturedError}
                className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-lg transition-colors"
              >
                📤 Capture Error
              </button>
            </div>

            {/* Console Error Test */}
            <div className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
              <h2 className="text-xl font-semibold text-gray-800 mb-2">
                3. Console Error (Breadcrumb)
              </h2>
              <p className="text-gray-600 mb-4">
                Logs an error to console which Sentry will capture as a breadcrumb
              </p>
              <button
                onClick={testConsoleError}
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition-colors"
              >
                🍞 Log Error
              </button>
            </div>
          </div>

          <div className="mt-8 p-4 bg-purple-50 rounded-lg border border-purple-200">
            <h3 className="font-semibold text-purple-900 mb-2">
              📊 Check Your Results
            </h3>
            <p className="text-purple-800 text-sm">
              After clicking a button, check your Sentry dashboard at:{' '}
              <a
                href="https://sentry.io/organizations/the-open-sorcerers/issues/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-purple-600"
              >
                Sentry Dashboard
              </a>
            </p>
          </div>

          <div className="mt-6 text-center">
            <a
              href="/"
              className="text-purple-600 hover:text-purple-800 underline"
            >
              ← Back to Home
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

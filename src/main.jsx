import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// CRITICAL FIX: Bypass Web Locks in development to prevent Vite HMR deadlocks with Supabase.
// Supabase uses navigator.locks which freezes permanently when a tab hot-reloads improperly.
if (import.meta.env.DEV && navigator.locks) {
  const originalRequest = navigator.locks.request.bind(navigator.locks)
  navigator.locks.request = async (name, options, callback) => {
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    if (name.includes('supabase')) {
      // Execute instantly without acquiring a cross-tab lock
      return await callback()
    }
    return originalRequest(name, options, callback)
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

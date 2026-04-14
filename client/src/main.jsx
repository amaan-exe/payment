import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import axios from 'axios'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App.jsx'

// Set default base URL for production APIs (Render backend)
// In production (Vercel), VITE_API_URL must be set to the backend URL.
// In local development, it falls back to the Express server port 5000.
axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
        <Analytics />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)

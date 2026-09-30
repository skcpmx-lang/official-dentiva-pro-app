import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './design/tokens.css'
import './design/base.css'
import './design/components.css'

/**
 * Renderer entry point. The whole user interface is a single React application mounted into
 * `#root`; every privileged operation travels through the preload bridge into the main process.
 */
const container = document.getElementById('root')
if (!container) {
  throw new Error('The application root element is missing from index.html')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)

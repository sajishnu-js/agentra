import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Bundled locally rather than pulled from Google Fonts at runtime: the
// wordmark is the first thing painted, and a network round trip for it means
// a visible swap on every cold load (and no font at all offline).
import '@fontsource-variable/space-grotesk'
// Three more faces, each doing one job on the opening page: Orbitron for the
// Agentra wordmark, Syne for the lede statement, Manrope for the supporting
// line. Self-hosted for the same reason as above.
import '@fontsource-variable/orbitron'
import '@fontsource-variable/syne'
import '@fontsource-variable/manrope'

import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

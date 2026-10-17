import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

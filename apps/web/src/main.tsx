import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/rethink-sans'
import '@fontsource-variable/jetbrains-mono'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { lang } from './i18n'

document.documentElement.lang = lang

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

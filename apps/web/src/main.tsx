import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/rethink-sans'
import '@fontsource-variable/jetbrains-mono'
import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { lang } from './i18n'
import { AccountProvider } from './lib/account'
import { behaveAsApp, isDesktop } from './lib/desktop'

document.documentElement.lang = lang
if (isDesktop) behaveAsApp()

const root = document.getElementById('root')
if (!root) throw new Error('index.html has no #root element')
createRoot(root).render(
  <StrictMode>
    <AccountProvider>
      <App />
    </AccountProvider>
  </StrictMode>,
)

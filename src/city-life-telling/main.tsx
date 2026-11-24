import React from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import CityLifeTelling from './CityLifeTelling'
import type { AppMode } from './store.js'

/** Standalone boot for the dedicated City-Life-Telling deployment: no suite,
 *  no ForkNav — only the instrument. `?mode=urban-strategist` deep-links the
 *  developer mode; the choice is then persisted per device. */
const requested = new URLSearchParams(window.location.search).get('mode')
const initialMode: AppMode | undefined = requested === 'urban-strategist'
  ? 'strategist'
  : requested === 'citizens' || requested === 'citizen'
    ? 'citizen'
    : undefined

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <CityLifeTelling initialMode={initialMode} />
  </React.StrictMode>,
)

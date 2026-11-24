import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Dedicated CITY-LIFE-TELLING build: the realtime MATSim + geolocated
 *  storytelling app only — no suite hub, no other forks. */
export default defineConfig({
  plugins: [react()],
  server: { port: 5177, host: true },
  preview: { port: 5177, host: true },
  build: { chunkSizeWarningLimit: 1000 },
})

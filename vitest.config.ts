import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/*.spec.ts'],
    environment: 'node',
    // The end-to-end MATSim ⇄ stories integration test spawns the bridge and
    // walks the whole publish/read loop; keep the ceiling generous and CI-safe.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
})

import { ForkNav } from '../ForkNav'
import CityLifeTelling from './CityLifeTelling'

export default function CityLifeTellingDemo() {
  return (
    <>
      <ForkNav current="city-life-telling" />
      <div style={{
        maxWidth: 1240, margin: '12px auto 0', padding: '8px 12px',
        border: '1px dashed #1d6f6a', borderRadius: 8,
        font: '500 12px "IBM Plex Mono", ui-monospace, monospace', color: '#17544f',
        display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline',
      }}>
        <span>Suite copy is for development — the reference deployment is standalone:</span>
        <a href="https://city-life-telling.vercel.app" target="_blank" rel="noreferrer" style={{ color: '#1d6f6a' }}>live ↗</a>
      </div>
      <CityLifeTelling />
    </>
  )
}

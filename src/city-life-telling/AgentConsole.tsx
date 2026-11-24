import { useEffect, useMemo, useRef } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { positionAlong, type DensityCell, type SimAgent } from './matsim/agents.js'
import type { CalibrationScope, FocusArea } from './matsim/calibration.js'
import { SEED_LINES } from './matsim/network.js'

/** A deliberately stylised, abstract view of the current MATSim agents.
 *
 *  Two scopes:
 *  - **focus**: detail around the jam hotspot (agents + focus ring);
 *  - **city**: whole-city density field (≈1 km cells) plus a capped agent
 *    sample, drawn light (no glow/trails above 800 dots) so a plain 2D
 *    canvas stays smooth. A field, not a pretend full-agent render.
 *
 *  No base map, no cartography chrome: a dark instrument panel. Positions
 *  reuse the same deterministic progress/speed values as the simulation. */

interface Props {
  agents: SimAgent[]
  focus: FocusArea
  density: DensityCell[]
  scope: CalibrationScope
  tick: number
  budget: number
  ariaLabel: string
  tickLabel: string
  scopeLabel: string
}

const LAT_KM = 110.57
const LON_KM = 111.32

export default function AgentConsole({
  agents, focus, density, scope, tick, budget, ariaLabel, tickLabel, scopeLabel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const baseMapEl = useRef<HTMLDivElement | null>(null)
  const baseMap = useRef<L.Map | null>(null)
  const view = useMemo(() => {
    if (scope === 'city') {
      const lats = SEED_LINES.flatMap((line) => line.stops.map((stop) => stop.lat))
      const lons = SEED_LINES.flatMap((line) => line.stops.map((stop) => stop.lon))
      return {
        latMin: Math.min(...lats) - 0.02, latMax: Math.max(...lats) + 0.02,
        lonMin: Math.min(...lons) - 0.03, lonMax: Math.max(...lons) + 0.03,
      }
    }
    const cos = Math.cos((focus.lat * Math.PI) / 180)
    const spanLat = (focus.radiusKm / LAT_KM) * 1.5
    return {
      latMin: focus.lat - spanLat, latMax: focus.lat + spanLat,
      lonMin: focus.lon - spanLat / cos, lonMax: focus.lon + spanLat / cos,
    }
  }, [scope, focus])

  /* Ghost cartographic reference: a non-interactive OSM base map, desaturated
   * and darkened by CSS, so the instrument view keeps the map in its backdrop.
   * The canvas above it is transparent; projection uses the Leaflet container
   * points, so wireframe/agents land exactly on the streets. */
  useEffect(() => {
    if (!baseMapEl.current || baseMap.current) return
    const map = L.map(baseMapEl.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      zoomSnap: 0.25,
    })
    map.attributionControl.setPrefix('')
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      className: 'clt-ghost-tiles',
    }).addTo(map)
    baseMap.current = map
    return () => { map.remove(); baseMap.current = null }
  }, [])

  useEffect(() => {
    const map = baseMap.current
    if (!map) return
    map.fitBounds([[view.latMin, view.lonMin], [view.latMax, view.lonMax]], { animate: false })
    const id = window.setTimeout(() => map.invalidateSize(), 0)
    return () => window.clearTimeout(id)
  }, [view])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const centreLat = (view.latMin + view.latMax) / 2
    const cos = Math.cos((centreLat * Math.PI) / 180)
    const map = baseMap.current
    let frame = 0
    let last = 0
    let width = 0
    let height = 0
    let pxPerKm = 1
    const start = performance.now()

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = canvas.clientWidth
      height = canvas.clientHeight
      if (width === 0 || height === 0) return false
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (map) {
        // Scale derived from the real base map so the scale bar and density
        // cells match the streets.
        const a = map.latLngToContainerPoint([centreLat, 0])
        const b = map.latLngToContainerPoint([centreLat + 0.01, 0])
        pxPerKm = Math.max(0.1, Math.abs(a.y - b.y) / (0.01 * LAT_KM))
      } else {
        const latSpanKm = (view.latMax - view.latMin) * LAT_KM
        const lonSpanKm = (view.lonMax - view.lonMin) * LON_KM * cos
        pxPerKm = Math.min(width / lonSpanKm, height / latSpanKm)
      }
      return true
    }

    const project = (lat: number, lon: number): [number, number] => {
      if (map) {
        const point = map.latLngToContainerPoint([lat, lon])
        return [point.x, point.y]
      }
      return [
        width / 2 + (lon - (view.lonMin + view.lonMax) / 2) * LON_KM * cos * pxPerKm,
        height / 2 - (lat - centreLat) * LAT_KM * pxPerKm,
      ]
    }

    const draw = (elapsed: number) => {
      if (!resize()) return
      ctx.clearRect(0, 0, width, height)

      // Dark instrument veil over the ghost base map, plus a soft vignette.
      ctx.fillStyle = 'rgba(8,12,11,0.58)'
      ctx.fillRect(0, 0, width, height)
      const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.08, width / 2, height / 2, height * 0.8)
      vignette.addColorStop(0, 'rgba(29,111,106,0.10)')
      vignette.addColorStop(1, 'rgba(0,0,0,0.24)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, width, height)

      // City scope: the density field, behind everything else.
      if (scope === 'city') {
        const cellPx = Math.max(2, 0.012 * LAT_KM * pxPerKm)
        for (const cell of density) {
          const [x, y] = project(cell.lat, cell.lon)
          ctx.fillStyle = `rgba(79,181,174,${(0.05 + cell.weight * 0.4).toFixed(3)})`
          ctx.fillRect(x - cellPx / 2, y - cellPx / 2, cellPx, cellPx)
        }
      }

      // Wireframe of the city map: the network skeleton stays visible in both
      // scopes — a dark halo lifts it above the density field, then the line
      // is stroked in its colour and the stations are ticked.
      for (const line of SEED_LINES) {
        const path = new Path2D()
        line.stops.forEach((stop, index) => {
          const [x, y] = project(stop.lat, stop.lon)
          if (index === 0) path.moveTo(x, y)
          else path.lineTo(x, y)
        })
        ctx.strokeStyle = 'rgba(4, 8, 7, 0.75)'
        ctx.lineWidth = scope === 'city' ? 3.2 : 2.6
        ctx.stroke(path)
        ctx.strokeStyle = `${line.color}${scope === 'city' ? 'b8' : '88'}`
        ctx.lineWidth = scope === 'city' ? 1.15 : 1.3
        ctx.stroke(path)
        ctx.fillStyle = `${line.color}dd`
        for (const stop of line.stops) {
          const [x, y] = project(stop.lat, stop.lon)
          if (scope === 'city') ctx.fillRect(x - 1, y - 1, 2, 2)
          else ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
        }
      }

      // Instrument frame: corner brackets + scale bar (wireframe feel).
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1
      const inset = 10
      const arm = 12
      for (const [cx, cy, dx, dy] of [
        [inset, inset, 1, 1], [width - inset, inset, -1, 1],
        [inset, height - inset, 1, -1], [width - inset, height - inset, -1, -1],
      ]) {
        ctx.beginPath()
        ctx.moveTo(cx + dx * arm, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy * arm)
        ctx.stroke()
      }
      const km = pxPerKm * 120 >= 5 ? 5 : pxPerKm * 120 >= 2 ? 2 : 1
      const barPx = km * pxPerKm
      const barY = height - 22
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.beginPath()
      ctx.moveTo(width - inset - barPx, barY); ctx.lineTo(width - inset, barY)
      ctx.moveTo(width - inset - barPx, barY - 3); ctx.lineTo(width - inset - barPx, barY + 3)
      ctx.moveTo(width - inset, barY - 3); ctx.lineTo(width - inset, barY + 3)
      ctx.stroke()
      ctx.fillStyle = 'rgba(207,227,223,0.75)'
      ctx.font = '9px "IBM Plex Mono", ui-monospace, monospace'
      ctx.textAlign = 'right'
      ctx.fillText(`${km} km`, width - inset, barY - 6)
      ctx.textAlign = 'left'

      // Focus ring, always visible (faint at city scale).
      ctx.save()
      ctx.setLineDash([5, 6])
      ctx.strokeStyle = scope === 'city' ? 'rgba(29,111,106,0.45)' : 'rgba(29,111,106,0.85)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(...project(focus.lat, focus.lon), Math.max(2, focus.radiusKm * pxPerKm), 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // Centre crosshair (focus scope only).
      if (scope === 'focus') {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.beginPath()
        ctx.moveTo(width / 2 - 7, height / 2); ctx.lineTo(width / 2 + 7, height / 2)
        ctx.moveTo(width / 2, height / 2 - 7); ctx.lineTo(width / 2, height / 2 + 7)
        ctx.stroke()
      }

      // Agents: glow + trails in the detail view; light dots in the city view.
      const light = scope === 'city' && agents.length > 800
      for (const agent of agents) {
        const line = SEED_LINES.find((l) => l.id === agent.lineId)
        const colour = line?.color ?? '#4fb5ae'
        const progress = agent.progress + agent.direction * agent.speed * elapsed
        const [x, y] = project(...positionAlong(agent.lineId, progress))
        if (light) {
          ctx.fillStyle = `${colour}cc`
          ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill()
          continue
        }
        const tail = progress - agent.direction * agent.speed * 1.6
        const [tx, ty] = project(...positionAlong(agent.lineId, tail))
        ctx.strokeStyle = `${colour}66`
        ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke()
        ctx.shadowColor = colour
        ctx.shadowBlur = 7
        ctx.fillStyle = colour
        ctx.beginPath(); ctx.arc(x, y, 2.1, 0, Math.PI * 2); ctx.fill()
        ctx.shadowBlur = 0
      }
    }

    const animate = () => {
      frame = requestAnimationFrame(animate)
      const now = performance.now()
      if (now - last < 33) return
      last = now
      draw((now - start) / 1000)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [agents, focus, density, scope, view])

  return (
    <div className="clt-console-map" data-testid="agent-console" data-scope={scope}>
      <div ref={baseMapEl} className="clt-console-basemap" aria-hidden="true" />
      <canvas ref={canvasRef} className="clt-console-canvas" role="img" aria-label={ariaLabel} />
      <div className="clt-console-overlay">
        <span className="clt-console-chip">{tickLabel} <b>{tick}</b></span>
        <span className={`clt-console-chip clt-console-scope ${scope}`}>{scopeLabel}</span>
        <span className="clt-console-chip">{agents.length} / {budget}</span>
        <span className="clt-console-chip clt-console-focus">{focus.label} · {focus.radiusKm} km</span>
      </div>
    </div>
  )
}

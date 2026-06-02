'use client'
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface MapRun {
  id: string
  letter: string
  color: string
  label: string
  yard: { lat: number; lon: number } | null
  stops: { lat: number; lon: number; label: string }[]
  geometry?: [number, number][] // [lat, lon] road path; falls back to straight lines
}

// Free, no-API-key basemap styles. (Style list for the picker lives in
// CapacityPlanner as MAP_STYLES so importing it doesn't pull Leaflet into SSR.)
const TILE_DEFS: Record<string, { url: string; attribution: string; subdomains: string }> = {
  standard:  { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors', subdomains: 'abc' },
  light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd' },
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd' },
  voyager:   { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri', subdomains: 'abc' },
}

// Imperative Leaflet — avoids react-leaflet's React-version coupling and the
// default-marker-icon asset problem (we use circleMarkers, no image icons).
export default function MapView({ runs, tileStyle = 'voyager' }: { runs: MapRun[]; tileStyle?: string }) {
  const elRef    = useRef<HTMLDivElement>(null)
  const mapRef   = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const tileRef  = useRef<L.TileLayer | null>(null)

  // Init the map once.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return
    const map = L.map(elRef.current, { scrollWheelZoom: true }).setView([43.4, -71.2], 7)
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // Container may have been laid out below the fold; make sure size is correct.
    setTimeout(() => map.invalidateSize(), 0)
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; tileRef.current = null }
  }, [])

  // Swap the basemap tiles when the style changes. (Tiles live in their own
  // pane below the route overlay, so order vs. the route layer doesn't matter.)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tileRef.current) { tileRef.current.remove(); tileRef.current = null }
    const def = TILE_DEFS[tileStyle] || TILE_DEFS.voyager
    tileRef.current = L.tileLayer(def.url, { attribution: def.attribution, subdomains: def.subdomains, maxZoom: 19 }).addTo(map)
  }, [tileStyle])

  // Redraw whenever the runs change.
  useEffect(() => {
    const map = mapRef.current
    const group = layerRef.current
    if (!map || !group) return
    group.clearLayers()
    const bounds: [number, number][] = []

    for (const r of runs) {
      const straight: [number, number][] = [
        ...(r.yard ? [[r.yard.lat, r.yard.lon] as [number, number]] : []),
        ...r.stops.map(s => [s.lat, s.lon] as [number, number]),
        ...(r.yard ? [[r.yard.lat, r.yard.lon] as [number, number]] : []),
      ]
      const line = r.geometry && r.geometry.length >= 2 ? r.geometry : straight

      if (line.length >= 2) {
        L.polyline(line, { color: r.color, weight: 4, opacity: 0.85 }).addTo(group)
        line.forEach(p => bounds.push(p))
      }
      if (r.yard) {
        L.circleMarker([r.yard.lat, r.yard.lon], {
          radius: 7, color: '#ffffff', weight: 2, fillColor: r.color, fillOpacity: 1,
        }).bindTooltip(`🏠 Yard — ${r.label}`, { direction: 'top' }).addTo(group)
        bounds.push([r.yard.lat, r.yard.lon])
      }
      r.stops.forEach((s, idx) => {
        L.circleMarker([s.lat, s.lon], {
          radius: 5, color: r.color, weight: 2, fillColor: '#ffffff', fillOpacity: 1,
        }).bindTooltip(`${r.letter}${idx + 1}. ${s.label}`, { direction: 'top' }).addTo(group)
        bounds.push([s.lat, s.lon])
      })

      // Lettered pin at the run's destination (last stop) so overlapping
      // routes stay distinguishable.
      const last = r.stops[r.stops.length - 1] || r.yard
      if (last) {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${r.color};color:#fff;font-weight:800;font-size:11px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,.6)">${r.letter}</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        })
        L.marker([last.lat, last.lon], { icon }).bindTooltip(`Route ${r.letter} — ${r.label}`, { direction: 'top' }).addTo(group)
      }
    }

    if (bounds.length >= 1) {
      map.fitBounds(bounds as L.LatLngBoundsLiteral, { padding: [30, 30], maxZoom: 12 })
    }
  }, [runs])

  return <div ref={elRef} style={{ height: 620, width: '100%', borderRadius: 8, overflow: 'hidden' }} />
}

'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_CONFIG, type OptimizerConfig } from './config'
import { loadAppSettings, upsertAppSetting } from './db'

// All editable runtime settings live in the `app_settings` table as JSONB
// rows keyed by group ("optimizer", future "ui", ...). Defaults come from
// APP_CONFIG; the DB row overlays per-key.

type GroupValues = Partial<Record<keyof OptimizerConfig, unknown>>

interface SettingsState {
  optimizer: OptimizerConfig
}

interface SettingsContextValue {
  settings: SettingsState
  loaded: boolean
  setOptimizer: (next: OptimizerConfig) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function defaultsForGroup(key: 'optimizer'): OptimizerConfig {
  if (key === 'optimizer') return { ...APP_CONFIG.optimizer }
  // Future groups would branch here.
  return { ...APP_CONFIG.optimizer }
}

function mergeOptimizer(raw: unknown): OptimizerConfig {
  const base = defaultsForGroup('optimizer')
  if (!raw || typeof raw !== 'object') return base
  const r = raw as GroupValues
  const num = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const list = (v: unknown, fallback: string[]) => {
    if (Array.isArray(v)) return v.map(String).filter(Boolean)
    return fallback
  }
  return {
    callsPerDriverPerHour: num(r.callsPerDriverPerHour, base.callsPerDriverPerHour),
    understaffedThreshold: num(r.understaffedThreshold, base.understaffedThreshold),
    overstaffedThreshold: num(r.overstaffedThreshold, base.overstaffedThreshold),
    supplyFunctions: list(r.supplyFunctions, base.supplyFunctions),
    excludeYards: list(r.excludeYards, base.excludeYards),
    topUnderstaffedCount: num(r.topUnderstaffedCount, base.topUnderstaffedCount),
    topOverstaffedCount: num(r.topOverstaffedCount, base.topOverstaffedCount),
  }
}

export function SettingsProvider({
  supabase,
  children,
}: {
  supabase: SupabaseClient
  children: React.ReactNode
}) {
  const [optimizer, setOptimizerState] = useState<OptimizerConfig>(defaultsForGroup('optimizer'))
  const [loaded, setLoaded] = useState(false)

  // Initial fetch + realtime subscription for cross-tab sync.
  useEffect(() => {
    let alive = true

    loadAppSettings(supabase)
      .then(rows => {
        if (!alive) return
        const opt = rows.find(r => r.key === 'optimizer')
        if (opt) setOptimizerState(mergeOptimizer(opt.value))
      })
      .catch(err => console.warn('Settings load failed; using defaults.', err))
      .finally(() => { if (alive) setLoaded(true) })

    const channel = supabase
      .channel('app_settings_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings' },
        (payload: { eventType?: string; new?: { key?: string; value?: unknown } }) => {
          const row = payload.new
          if (!row?.key) return
          if (row.key === 'optimizer') {
            setOptimizerState(mergeOptimizer(row.value))
          }
        })
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
  }, [supabase])

  const setOptimizer = useCallback(async (next: OptimizerConfig) => {
    await upsertAppSetting(supabase, 'optimizer', next as unknown as Record<string, unknown>)
    setOptimizerState(next)
  }, [supabase])

  const value = useMemo<SettingsContextValue>(() => ({
    settings: { optimizer },
    loaded,
    setOptimizer,
  }), [optimizer, loaded, setOptimizer])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings called outside SettingsProvider')
  return ctx
}

// Convenience: read the merged optimizer config, falling back to defaults if
// the provider isn't mounted (e.g. during SSR).
export function useOptimizerConfig(): OptimizerConfig {
  const ctx = useContext(SettingsContext)
  return ctx ? ctx.settings.optimizer : defaultsForGroup('optimizer')
}

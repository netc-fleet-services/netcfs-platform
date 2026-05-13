'use client'

import { useEffect, useState } from 'react'
import { PortalHeader, ThemeToggle } from '@netcfs/ui'

interface Props {
  portalUrl: string
}

export function SchedulerHeader({ portalUrl }: Props) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    setTheme(stored === 'daylight' ? 'light' : 'dark')
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.className = next === 'dark' ? 'theme-midnight' : 'theme-daylight'
    setTheme(next)
    localStorage.setItem('theme', next === 'dark' ? 'midnight' : 'daylight')
  }

  return (
    <PortalHeader appTitle="Driver Scheduler" portalUrl={portalUrl}>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
    </PortalHeader>
  )
}

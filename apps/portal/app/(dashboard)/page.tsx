import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { type UserRole } from '@netcfs/auth/types'
import { AppTilesClient } from '@/components/AppTilesClient'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default async function HomePage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  const firstName = profile.full_name?.split(' ')[0] ?? profile.email.split('@')[0]
  const greeting  = getGreeting()

  return (
    <AppTilesClient
      role={profile.role as UserRole}
      firstName={firstName}
      greeting={greeting}
    />
  )
}

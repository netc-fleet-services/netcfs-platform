import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { FleetDashboard } from '@/components/fleet-dashboard'
import type { FleetProfile } from '@/lib/types'

export default async function FleetPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return <FleetDashboard profile={profile as FleetProfile} />
}

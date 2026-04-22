import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { ImpoundDashboard } from '@/components/impound-dashboard'
import type { ImpoundProfile } from '@/lib/types'

export default async function ImpoundsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return <ImpoundDashboard profile={profile as ImpoundProfile} />
}

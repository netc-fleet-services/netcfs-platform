import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { AdminSettings } from '@/components/admin-settings'
import type { FleetProfile } from '@/lib/types'

export default async function AdminPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if ((profile as any).role !== 'admin') redirect('/')
  return <AdminSettings profile={profile as FleetProfile} />
}

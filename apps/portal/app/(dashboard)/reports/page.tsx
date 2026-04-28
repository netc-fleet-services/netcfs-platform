import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { ROLE_PERMISSIONS } from '@netcfs/auth/types'
import { ReportsApp } from '@/components/ReportsApp'

export default async function ReportsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (!ROLE_PERMISSIONS[profile.role]?.includes('reports')) redirect('/')

  return <ReportsApp />
}

import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { hasPermission } from '@netcfs/auth/types'
import { ReportsApp } from '@/components/ReportsApp'

export default async function ReportsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (!hasPermission(profile.role, 'reports')) redirect('/')

  return <ReportsApp />
}

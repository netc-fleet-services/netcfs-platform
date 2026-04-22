import { redirect } from 'next/navigation'
import { getUserProfile } from '@netcfs/auth/server'
import { hasPermission } from '@netcfs/auth/types'
import type { UserRole } from '@netcfs/auth/types'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (!hasPermission(profile.role as UserRole, 'impounds')) redirect('/login')
  return <>{children}</>
}

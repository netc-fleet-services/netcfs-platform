import { redirect } from 'next/navigation'
import { getUserProfile } from '@netcfs/auth/server'
import { DashboardShell } from '@/components/dashboard-shell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  return <DashboardShell profile={profile}>{children}</DashboardShell>
}

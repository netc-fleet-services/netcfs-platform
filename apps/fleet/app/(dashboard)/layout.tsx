import { redirect } from 'next/navigation'
import { getUserProfile } from '@netcfs/auth/server'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return <>{children}</>
}

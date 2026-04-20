import { redirect } from 'next/navigation'
import { getUserProfile } from '@netcfs/auth/server'
import { Header } from '@/components/header'
import type { FleetProfile } from '@/lib/types'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return (
    <>
      <Header profile={profile as FleetProfile} />
      {children}
    </>
  )
}

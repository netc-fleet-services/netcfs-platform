import { redirect } from 'next/navigation'
import { getUserProfile } from '@netcfs/auth/server'
import { Header } from '@/components/header'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'shop_manager') redirect('/login')
  return (
    <>
      <Header profile={profile} />
      {children}
    </>
  )
}

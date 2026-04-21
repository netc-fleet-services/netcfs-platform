import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { DispatchBoard } from '../components/DispatchBoard'

export default async function TransportPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return <DispatchBoard />
}

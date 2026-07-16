import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { Board } from '../components/Board'

export default async function TransportPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')
  return <Board />
}

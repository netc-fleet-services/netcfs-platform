import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { SafetyApp } from '../components/SafetyApp'

export default async function SafetyPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  return <SafetyApp />
}

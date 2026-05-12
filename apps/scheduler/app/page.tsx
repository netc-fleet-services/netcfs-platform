import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { Scheduler } from '../components/Scheduler'

export default async function SchedulerPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  return (
    <main className="sched-main">
      <Scheduler />
    </main>
  )
}

import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { SwapTool } from '../components/SwapTool'

export default async function SwapsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  return (
    <main className="fsm-main">
      <div className="fsm-hero">
        <div className="fsm-hero-tag">NETCFS · Fleet Analytics</div>
        <h1>Fleet Lifecycle Swap Tool</h1>
        <p>Calculate the optimal time to replace a truck by minimizing total cost of ownership across depreciation, maintenance escalation, and downtime revenue loss.</p>
      </div>
      <div className="fsm-tool-card">
        <SwapTool />
      </div>
    </main>
  )
}

import { getUserProfile } from '@netcfs/auth/server'
import { redirect } from 'next/navigation'
import { PreTripAuditTool } from '../components/PreTripAuditTool'

export default async function InspectionsPage() {
  const profile = await getUserProfile()
  if (!profile) redirect('/login')

  return (
    <main className="pit-main">
      <div className="pit-hero">
        <div className="pit-hero-tag">NETCFS · Compliance Tools</div>
        <h1>Pre-Trip Compliance Audit</h1>
        <p>
          Upload your Towbook Driver Activity and PreTrip Inspections exports
          to instantly calculate each driver&apos;s required, completed, and missed
          inspections — with search, sort, and Excel export.
        </p>
      </div>
      <div className="pit-tool-card">
        <PreTripAuditTool />
      </div>
    </main>
  )
}

import type { Metadata } from 'next'
import { PortalHeader } from '@netcfs/ui'
import './globals.css'

export const metadata: Metadata = {
  title: 'Quote Calculator — NETCFS',
  description: 'Towing quote calculator',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="theme-midnight">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PortalHeader
          appTitle="Quote Calculator"
          portalUrl={process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3000'}
        />
        {children}
      </body>
    </html>
  )
}

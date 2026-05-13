import type { Metadata } from 'next'
import { SchedulerHeader } from '../components/SchedulerHeader'
import './globals.css'

export const metadata: Metadata = {
  title: 'Driver Scheduler — NETCFS',
  description: 'Live multi-dispatcher driver scheduling',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="theme-midnight">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='daylight'){document.documentElement.className='theme-daylight';}else{document.documentElement.className='theme-midnight';}}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <SchedulerHeader portalUrl={process.env.NEXT_PUBLIC_PORTAL_URL || 'http://localhost:3000'} />
        {children}
      </body>
    </html>
  )
}

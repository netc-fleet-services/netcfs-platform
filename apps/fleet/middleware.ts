import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@netcfs/auth/middleware'

// Cron endpoints authenticate themselves via CRON_SECRET (Bearer token), so they
// must skip the session-cookie auth redirect — external callers (Supabase pg_cron,
// Vercel Cron) have no login session and would otherwise be bounced to /login.
const CRON_PATHS = ['/api/notify-flush', '/api/notify-reminder']

export async function middleware(request: NextRequest) {
  if (CRON_PATHS.some(p => request.nextUrl.pathname.startsWith(p))) {
    return NextResponse.next()
  }
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}

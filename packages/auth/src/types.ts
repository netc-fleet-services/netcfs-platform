export type UserRole = 'admin' | 'shop_manager' | 'dispatcher' | 'mechanic' | 'driver' | 'viewer' | 'impound_manager'

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  avatar_url: string | null
  created_at: string
}

export interface AuthSession {
  user: {
    id: string
    email: string
  }
  profile: UserProfile | null
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin:           'Admin',
  shop_manager:    'Shop Manager',
  dispatcher:      'Dispatcher',
  mechanic:        'Mechanic',
  driver:          'Driver',
  viewer:          'Viewer',
  impound_manager: 'Impound Manager',
}

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin:           ['fleet', 'transport', 'inspections', 'swaps', 'reports', 'settings', 'admin', 'impounds'],
  shop_manager:    ['fleet'],
  dispatcher:      ['fleet', 'transport', 'inspections', 'swaps', 'reports', 'impounds'],
  mechanic:        ['fleet', 'inspections'],
  driver:          ['fleet'],
  viewer:          ['fleet', 'transport', 'inspections', 'swaps', 'reports'],
  impound_manager: ['impounds'],
}

export function hasPermission(role: UserRole, module: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(module) ?? false
}

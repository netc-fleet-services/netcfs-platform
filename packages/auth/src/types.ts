export type UserRole = 'admin' | 'dispatcher' | 'mechanic' | 'viewer' | 'impound_manager'

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
  dispatcher:      'Dispatcher',
  mechanic:        'Mechanic',
  viewer:          'Viewer',
  impound_manager: 'Impound Manager',
}

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  admin:           ['fleet', 'transport', 'inspections', 'swaps', 'reports', 'settings', 'admin', 'impounds'],
  dispatcher:      ['fleet', 'transport', 'reports', 'impounds'],
  mechanic:        ['fleet', 'inspections'],
  viewer:          ['fleet', 'transport', 'inspections', 'swaps', 'reports'],
  impound_manager: ['impounds'],
}

export function hasPermission(role: UserRole, module: string): boolean {
  return ROLE_PERMISSIONS[role]?.includes(module) ?? false
}

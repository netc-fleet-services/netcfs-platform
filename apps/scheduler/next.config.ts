import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@netcfs/ui', '@netcfs/auth', '@netcfs/db', '@netcfs/utils'],
}

export default nextConfig

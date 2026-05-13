import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@netcfs/ui', '@netcfs/auth'],
}

export default nextConfig

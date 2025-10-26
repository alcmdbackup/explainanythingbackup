import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Webpack configuration for additional transformations
  webpack: (config, { dev, isServer }) => {
    // Only apply to client-side in development
    if (dev && !isServer) {
      // Additional webpack plugins could go here for client logging
      console.log('🔧 Client-side webpack configuration loaded for development');
    }

    return config;
  },

  // Experimental features that might be needed
  experimental: {
    // Enable if needed for better build-time analysis
    swcPlugins: [],
  }
};

export default nextConfig;

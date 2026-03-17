import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Bundle analyzer - only loaded when ANALYZE=true
const withBundleAnalyzer = process.env.ANALYZE === 'true'
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ? require('@next/bundle-analyzer')({ enabled: true })
  : (config: NextConfig) => config;

const nextConfig: NextConfig = {
  // Permanent redirects from old /admin/quality/* routes to new /admin/evolution/* routes
  async redirects() {
    return [
      { source: '/admin/quality/evolution', destination: '/admin/evolution/runs', permanent: true },
      { source: '/admin/quality/evolution/run/:runId/compare', destination: '/admin/evolution/runs/:runId/compare', permanent: true },
      { source: '/admin/quality/evolution/run/:runId', destination: '/admin/evolution/runs/:runId', permanent: true },
      { source: '/admin/quality/evolution/variant/:variantId', destination: '/admin/evolution/variants/:variantId', permanent: true },
      { source: '/admin/quality/evolution/invocation/:invocationId', destination: '/admin/evolution/invocations/:invocationId', permanent: true },
      { source: '/admin/quality/strategies/:strategyId', destination: '/admin/evolution/strategies/:strategyId', permanent: true },
      { source: '/admin/quality/strategies', destination: '/admin/evolution/strategies', permanent: true },
      { source: '/admin/quality/prompts', destination: '/admin/evolution/prompts', permanent: true },
      { source: '/admin/quality/arena/:topicId', destination: '/admin/evolution/arena/:topicId', permanent: true },
      { source: '/admin/quality/arena', destination: '/admin/evolution/arena', permanent: true },
      { source: '/admin/quality/optimization/experiment/:experimentId', destination: '/admin/evolution/experiments/:experimentId', permanent: true },
      { source: '/admin/quality/explorer', destination: '/admin/evolution/runs', permanent: true },
    ];
  },

  // Webpack configuration for additional transformations
  webpack: (config, { dev, isServer }) => {
    // Only apply to client-side in development
    if (dev && !isServer) {
      // Additional webpack plugins could go here for client logging
      console.log('🔧 Client-side webpack configuration loaded for development');
    }

    return config;
  },

  // Turbopack alias for @evolution/* (workaround for Next.js 15.2.x path alias bug)
  turbopack: {
    resolveAlias: {
      '@evolution/*': './evolution/src/*',
    },
  },

  // Experimental features that might be needed
  experimental: {
    // Enable if needed for better build-time analysis
    swcPlugins: [],
  }
};

// Sentry configuration options
const sentryWebpackPluginOptions = {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options

  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Only upload source maps in production and when auth token is available
  silent: !process.env.SENTRY_AUTH_TOKEN,

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Automatically annotate React component names for Sentry
  reactComponentAnnotation: {
    enabled: true,
  },

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/api/monitoring",

  // Hides source maps from generated client bundles
  hideSourceMaps: true,

  // Keep Sentry.logger enabled for Sentry Logs feature
  // Note: disableLogger: true would tree-shake Sentry.logger calls
  disableLogger: false,

  // Enables automatic instrumentation of Vercel Cron Monitors.
  automaticVercelMonitors: true,
};

// Only wrap with Sentry if DSN is configured
const sentryWrappedConfig = process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;

// Apply bundle analyzer wrapper (no-op unless ANALYZE=true)
const config = withBundleAnalyzer(sentryWrappedConfig);

export default config;

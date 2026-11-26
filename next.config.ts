import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Bills uploaded in the Inventory Management System (photos are shrunk on the phone first; Vercel caps bodies at 4.5 MB).
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;

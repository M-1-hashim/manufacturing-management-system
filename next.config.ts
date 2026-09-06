import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Electron 桌面版构建使用独立 distDir（NEXT_DIST_DIR），避免影响运行中的 dev server
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // MySQL Prisma client (generated at desktop-build time) must stay external:
  // bundling would break its native engine lookup inside the Electron package.
  serverExternalPackages: ["prisma-mysql-client"],
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;

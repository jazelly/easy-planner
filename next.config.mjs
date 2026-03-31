/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["typeorm", "better-sqlite3", "pg", "sql.js"]
};

export default nextConfig;

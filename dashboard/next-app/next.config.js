/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,   // Off — vanilla‑JS scripts mutate the DOM directly
  output: 'standalone',     // Helpful for Render deployment
  // The existing public/js/* files are served as‑is from /public
};

module.exports = nextConfig;

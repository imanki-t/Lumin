/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,  // Off — vanilla-JS scripts mutate the DOM directly
  basePath: '/dashboard',  // Dashboard is mounted at /dashboard inside Express
  // Note: no `output: 'standalone'` — Next.js runs as a handler inside Express,
  // not as its own standalone server.
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/friendlies',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
    ],
  },
};
module.exports = nextConfig;

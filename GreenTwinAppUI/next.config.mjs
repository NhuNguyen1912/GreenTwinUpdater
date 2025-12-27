/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  serverExternalPackages: [
    'three',
    '@react-three/fiber',
    '@react-three/drei',
    'camera-controls',
    'mapbox-gl' 
  ]
};

export default nextConfig;

import { config } from "dotenv";
import { resolve } from "path";
import type { NextConfig } from "next";

// Load root .env so NEXT_PUBLIC_* vars are available to the frontend
config({ path: resolve(__dirname, "../.env") });

const nextConfig: NextConfig = {};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep visited ledger tabs in the client cache for 5 minutes so switching tabs is instant.
    // Mutations call revalidatePath, which clears it immediately.
    staleTimes: {
      dynamic: 300,
    },
  },
};

export default nextConfig;

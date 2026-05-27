import type { NextConfig } from "next";

function buildRemotePatterns() {
  const patterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [];

  const customDomain = process.env.AWS_S3_CUSTOM_DOMAIN?.trim();
  if (customDomain) {
    const normalized = customDomain.startsWith("http://") || customDomain.startsWith("https://")
      ? customDomain
      : `https://${customDomain}`;
    const parsed = new URL(normalized);
    patterns.push({
      protocol: parsed.protocol.replace(":", "") as "http" | "https",
      hostname: parsed.hostname,
      port: parsed.port,
      pathname: "/**",
    });
  }

  const bucketName = process.env.AWS_S3_BUCKET_NAME?.trim();
  const regionName = process.env.AWS_S3_REGION_NAME?.trim();
  if (bucketName) {
    patterns.push({
      protocol: "https",
      hostname: `${bucketName}.s3.amazonaws.com`,
      pathname: "/**",
    });

    if (regionName) {
      patterns.push({
        protocol: "https",
        hostname: `${bucketName}.s3.${regionName}.amazonaws.com`,
        pathname: "/**",
      });
    }
  }

  const endpointUrl = process.env.AWS_S3_ENDPOINT_URL?.trim();
  if (endpointUrl) {
    const parsed = new URL(
      endpointUrl.startsWith("http://") || endpointUrl.startsWith("https://")
        ? endpointUrl
        : `https://${endpointUrl}`,
    );
    patterns.push({
      protocol: parsed.protocol.replace(":", "") as "http" | "https",
      hostname: parsed.hostname,
      port: parsed.port,
      pathname: "/**",
    });
  }

  return patterns;
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: buildRemotePatterns(),
  },
};

export default nextConfig;

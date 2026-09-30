import baseConfig from "./base-config.json" with { type: "json" };
import linuxBaseConfig from "./base-config-linux.json" with { type: "json" };
import { applyIosPolicy } from "./ios-policy.js";
import {
  mergeLinuxSubscription,
  mergeSubscription,
  subscriptionNodeCount,
} from "./merge.js";

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function notFound() {
  return new Response("Not Found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET") return notFound();

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length !== 2 || !safeEqual(pathParts[0], env.ACCESS_TOKEN)) {
      return notFound();
    }

    let platform;
    let profileBase;
    let mergeProfile;
    if (pathParts[1] === "config.json") {
      platform = "ios";
      profileBase = baseConfig;
      mergeProfile = mergeSubscription;
    } else if (pathParts[1] === "linux.json") {
      platform = "linux";
      profileBase = linuxBaseConfig;
      mergeProfile = mergeLinuxSubscription;
    } else {
      return notFound();
    }

    try {
      const upstreamResponse = await fetch(env.UPSTREAM_URL, {
        headers: {
          Accept: "application/json",
          "User-Agent": "sing-box/1.14",
        },
        cf: { cacheTtl: 300, cacheEverything: true },
      });
      if (!upstreamResponse.ok) {
        throw new Error(`upstream returned HTTP ${upstreamResponse.status}`);
      }

      const subscriptionConfig = await upstreamResponse.json();
      const mergedConfig = mergeProfile(profileBase, subscriptionConfig);
      const profile = platform === "ios" ? applyIosPolicy(mergedConfig, {
        localDnsSuffixes: env.LOCAL_DNS_SUFFIXES,
        cnCdnSuffixes: env.CN_CDN_SUFFIXES,
      }) : mergedConfig;
      const body = JSON.stringify(profile, null, 2);

      return new Response(body, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "application/json; charset=utf-8",
          "X-Profile-Node-Count": String(subscriptionNodeCount(subscriptionConfig)),
          "X-Profile-Platform": platform,
        },
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : "profile generation failed");
      return Response.json(
        { error: "profile generation failed" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};

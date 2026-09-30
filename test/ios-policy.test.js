import assert from "node:assert/strict";
import test from "node:test";
import baseConfig from "../src/base-config.json" with { type: "json" };
import { applyIosPolicy } from "../src/ios-policy.js";

test("iOS policy enables dual-stack without mutating the base profile", () => {
  const original = structuredClone(baseConfig);
  const candidate = applyIosPolicy(baseConfig);

  assert.deepEqual(baseConfig, original);
  assert.deepEqual(candidate.inbounds[0].address, ["172.19.0.1/30", "fdfe:dcba:9876::1/126"]);
  assert.equal(candidate.dns.strategy, "prefer_ipv4");
  assert.equal(candidate.dns.servers.find((item) => item.tag === "alidns-1").type, "https");
  assert.equal(candidate.dns.servers.find((item) => item.tag === "alidns-1").tls.server_name, "dns.alidns.com");
  assert.equal(candidate.route.rules.find((item) => item.action === "resolve").strategy, "prefer_ipv4");
  assert.equal(candidate.dns.rules.some((item) => item.action === "predefined" && item.query_type?.includes("AAAA")), false);
  assert.equal(baseConfig.dns.strategy, "ipv4_only");
});

test("iOS policy resolves local names before public rule sets", () => {
  const candidate = applyIosPolicy(baseConfig, { localDnsSuffixes: "myhome.example, lab.example" });
  const localRule = candidate.dns.rules.find((item) => item.server === "system-dns");
  const localRoute = candidate.route.rules.find((item) => item.domain_suffix?.includes("myhome.example"));

  assert.deepEqual(localRule.domain_suffix, ["local", "lan", "home.arpa", "myhome.example", "lab.example"]);
  assert.equal(candidate.dns.rules.indexOf(localRule), 1);
  assert.equal(localRoute.outbound, "direct");
  assert.deepEqual(candidate.dns.servers.find((item) => item.tag === "system-dns").neighbor_domain,
    [".", ".lan", ".local", ".home.arpa"]);
});

test("iOS policy only makes opted-in CDN domains direct when resolved to a CN IP", () => {
  const candidate = applyIosPolicy(baseConfig, { cnCdnSuffixes: "cdn.example,assets.example" });
  const dnsRule = candidate.dns.rules.find((item) => item.domain_suffix?.includes("cdn.example"));
  const routeRule = candidate.route.rules.find((item) => item.type === "logical");

  assert.equal(dnsRule.server, "system-dns");
  assert.equal(dnsRule.action, "route");
  assert.equal(routeRule.mode, "and");
  assert.deepEqual(routeRule.rules, [
    { domain_suffix: ["cdn.example", "assets.example"] },
    { rule_set: ["geoip-cn"] },
  ]);
  assert.equal(routeRule.outbound, "direct");
  assert.equal(candidate.route.final, "direct");
});

test("iOS policy rejects malformed suffix lists", () => {
  assert.throws(() => applyIosPolicy(baseConfig, { cnCdnSuffixes: "https://example.com" }), /invalid domain suffix/);
  assert.throws(() => applyIosPolicy(baseConfig, { localDnsSuffixes: "*.example.com" }), /invalid domain suffix/);
});

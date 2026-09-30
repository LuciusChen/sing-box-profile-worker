import assert from "node:assert/strict";
import test from "node:test";
import baseConfig from "../src/base-config.json" with { type: "json" };
import linuxBaseConfig from "../src/base-config-linux.json" with { type: "json" };
import { mergeLinuxSubscription, mergeSubscription } from "../src/merge.js";

function node(tag, port) {
  return {
    type: "trojan",
    tag,
    server: "example.com",
    server_port: port,
    password: `secret-${port}`,
    tls: { enabled: true, server_name: "example.com" },
  };
}

const subscription = {
  outbounds: [
    node("剩余流量：20 GB", 1),
    node("🇭🇰 香港 01", 101),
    node("🇭🇰 香港 05", 105),
    node("🇭🇰 香港 10", 110),
    node("🇸🇬 新加坡 01", 201),
    node("🇸🇬 新加坡 04", 204),
    node("🏳️‍🌈 台湾 01", 301),
    node("🇯🇵 日本 01", 401),
    node("🇯🇵 日本 04", 404),
    node("🇺🇸 美国 01", 501),
    node("🇺🇸 美国 04", 504),
    node("🇬🇧 英国", 601),
    node("🇰🇷 韩国", 701),
  ],
};

test("merges nodes while preserving custom configuration", () => {
  const merged = mergeSubscription(baseConfig, subscription);
  const byTag = new Map(merged.outbounds.map((item) => [item.tag, item]));
  const dnsServerByTag = new Map(merged.dns.servers.map((item) => [item.tag, item]));
  const ruleSetByTag = new Map(merged.route.rule_set.map((item) => [item.tag, item]));

  assert.equal(merged.route.final, "direct");
  assert.equal(merged.endpoints[0].type, "tailscale");
  assert.equal(merged.inbounds[0].udp_mapping, "address_and_port_dependent");
  assert.equal(byTag.has("剩余流量：20 GB"), false);
  assert.equal(byTag.get("Proxy").default, "Auto");
  assert.equal(byTag.get("Auto").outbounds.length, 10);
  assert.equal(merged.route.default_domain_resolver, "alidns-1");
  assert.equal(dnsServerByTag.get("alidns-1").type, "tcp");
  assert.equal(dnsServerByTag.get("alidns-2").type, "tcp");
  assert.equal(ruleSetByTag.get("geoip-google").type, "remote");
  assert.equal(
    merged.route.rules.some(
      (item) => item.outbound === "Proxy" && item.rule_set?.includes("geoip-google"),
    ),
    true,
  );
  assert.deepEqual(byTag.get("United Kingdom").outbounds, ["🇬🇧 英国"]);
  assert.deepEqual(byTag.get("Korea").outbounds, ["🇰🇷 韩国"]);
  assert.equal(
    merged.outbounds.filter((item) => item.type === "trojan").length,
    subscription.outbounds.length - 1,
  );
});

test("rejects duplicate node tags", () => {
  assert.throws(
    () => mergeSubscription(baseConfig, { outbounds: [node("duplicate", 1), node("duplicate", 2)] }),
    /duplicate node tag/,
  );
});

test("builds a Linux profile from the existing Arch template", () => {
  const merged = mergeLinuxSubscription(linuxBaseConfig, subscription);
  const byTag = new Map(merged.outbounds.map((item) => [item.tag, item]));

  assert.equal(merged.route.final, "Proxy");
  assert.equal(merged.route.auto_detect_interface, true);
  assert.deepEqual(merged.inbounds.map((item) => item.type), ["tun", "mixed"]);
  assert.deepEqual(merged.http_clients, [{
    tag: "rule-set-via-proxy",
    detour: "Proxy",
  }]);
  assert.equal(merged.route.default_http_client, "rule-set-via-proxy");
  assert.equal(merged.route.rule_set.every((item) => item.type === "remote"), true);
  assert.equal(merged.route.rule_set.every((item) => !Object.hasOwn(item, "download_detour")), true);
  assert.equal(merged.experimental.cache_file.store_dns, true);
  assert.equal(Object.hasOwn(merged.experimental.cache_file, "store_rdrc"), false);
  assert.equal(merged.experimental.clash_api.external_ui_download_detour, "Proxy");
  assert.equal(byTag.get("Auto").outbounds.length, subscription.outbounds.length - 1);
  assert.deepEqual(byTag.get("Auto-JP").outbounds, ["🇯🇵 日本 01", "🇯🇵 日本 04"]);
  assert.deepEqual(byTag.get("Auto-SG").outbounds, ["🇸🇬 新加坡 01", "🇸🇬 新加坡 04"]);
  assert.equal(byTag.get("Proxy").outbounds.at(0), "Auto");
  assert.equal(byTag.get("Proxy").outbounds.at(-1), "DIRECT");
});

test("Linux profile resolves proxy node hostnames through direct DNS", () => {
  const hosted = { ...node("hosted", 1), server: "node.example.net" };
  const merged = mergeLinuxSubscription(linuxBaseConfig, { outbounds: [hosted, node("ip", 2)] });
  const first = merged.dns.rules[1];

  assert.deepEqual(first.domain, ["node.example.net", "example.com"]);
  assert.equal(first.server, "dns_direct");
});

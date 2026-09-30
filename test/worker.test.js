import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

const environment = {
  ACCESS_TOKEN: "test-token",
  UPSTREAM_URL: "https://subscription.example/config.json",
};

test("existing iOS URL receives the updated policy; Linux URL remains separate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    outbounds: [{
      type: "trojan",
      tag: "Hong Kong Test",
      server: "node.example",
      server_port: 443,
      password: "test-password",
      tls: { enabled: true, server_name: "node.example" },
    }],
  });
  try {
    const ios = await worker.fetch(new Request("https://worker.example/test-token/config.json"), environment);
    const linux = await worker.fetch(new Request("https://worker.example/test-token/linux.json"), environment);
    const iosConfig = await ios.json();
    const linuxConfig = await linux.json();

    assert.equal(ios.status, 200);
    assert.equal(linux.status, 200);
    assert.equal(iosConfig.dns.strategy, "prefer_ipv4");
    assert.equal(linuxConfig.dns.strategy, "ipv4_only");
    // The Linux TUN has no IPv6 address, so advertising AAAA or an SVCB
    // ipv6hint yields addresses the host cannot route. Firefox honours the
    // HTTPS RR hint and fails with "Unable to connect"; curl does not read
    // HTTPS RR and so was unaffected.
    assert.deepEqual(linuxConfig.dns.rules[0], {
      query_type: ["HTTPS"],
      action: "predefined",
      rcode: "NOERROR",
    });
    // DNS rules must mirror route-rule precedence. Route sends geosite-google
    // to Proxy (rule 12) before geosite-cn goes DIRECT (rule 20), but 124
    // geosite-google domains also sit in geosite-cn -- including the exact
    // entries www.gstatic.com and fonts.gstatic.com. If the domestic resolver
    // wins, those resolve to CN addresses that the proxy node then dials: TCP
    // connects, TLS hangs, and Gmail never finishes loading. It also breaks
    // every urltest health check, since their default probe URL is
    // https://www.gstatic.com/generate_204.
    const linuxDnsRuleIndex = (set) =>
      linuxConfig.dns.rules.findIndex((rule) => rule.rule_set?.includes(set));
    assert.ok(linuxDnsRuleIndex("geosite-google") >= 0);
    assert.ok(linuxDnsRuleIndex("geosite-google") < linuxDnsRuleIndex("geosite-cn"));
    // Same precedence rule for the general case, matching the iOS profile,
    // which already resolves geosite-geolocation-!cn before geosite-cn.
    // geolocation-!cn covers 59 of the 124 google-in-cn domains (gstatic,
    // google.com, googleapis, googleusercontent); the explicit geosite-google
    // rule above covers the other 65, including crl.pki.goog.
    assert.ok(
      linuxDnsRuleIndex("geosite-geolocation-!cn") < linuxDnsRuleIndex("geosite-cn"),
    );

    assert.equal(iosConfig.inbounds[0].address.length, 2);
    assert.equal(linuxConfig.inbounds[0].address.length, 1);
    assert.equal(ios.headers.get("X-Profile-Platform"), "ios");
    assert.equal(linux.headers.get("X-Profile-Platform"), "linux");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("profile path requires the access token", async () => {
  const response = await worker.fetch(new Request("https://worker.example/nope/config.json"), environment);
  assert.equal(response.status, 404);
});

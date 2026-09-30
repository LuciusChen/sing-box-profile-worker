const LOCAL_SUFFIXES = ["local", "lan", "home.arpa"];

function parseSuffixes(value) {
  if (!value) return [];
  if (typeof value !== "string") throw new Error("domain suffixes must be a string");
  const suffixes = [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const validDomain = new RegExp(`^${label}(?:\\.${label})*$`);
  if (suffixes.length > 32 || suffixes.some((item) => item.length > 253 || !validDomain.test(item))) {
    throw new Error("invalid domain suffix list");
  }
  return suffixes;
}

export function applyIosPolicy(baseConfig, options = {}) {
  const config = structuredClone(baseConfig);
  const localSuffixes = [...new Set([...LOCAL_SUFFIXES, ...parseSuffixes(options.localDnsSuffixes)])];
  const cnCdnSuffixes = parseSuffixes(options.cnCdnSuffixes);

  config.inbounds.find((item) => item.type === "tun").address.push("fdfe:dcba:9876::1/126");
  config.dns.strategy = "prefer_ipv4";
  config.route.rules.find((item) => item.action === "resolve").strategy = "prefer_ipv4";
  config.dns.rules = config.dns.rules.filter((item) =>
    !(item.action === "predefined" && item.query_type?.includes("AAAA"))
  );

  const systemDns = config.dns.servers.find((item) => item.tag === "system-dns");
  systemDns.neighbor_domain = [".", ".lan", ".local", ".home.arpa"];
  for (const server of config.dns.servers.filter((item) => item.tag === "alidns-1" || item.tag === "alidns-2")) {
    server.type = "https";
    delete server.server_port;
    server.tls = { enabled: true, server_name: "dns.alidns.com" };
  }

  const localRule = { domain_suffix: localSuffixes, action: "route", server: "system-dns" };
  config.dns.rules.splice(1, 0, localRule);
  if (cnCdnSuffixes.length > 0) {
    config.dns.rules.splice(2, 0, {
      domain_suffix: cnCdnSuffixes,
      action: "route",
      server: "system-dns",
    });
  }

  const routeRules = [
    { domain_suffix: localSuffixes, action: "route", outbound: "direct" },
  ];
  if (cnCdnSuffixes.length > 0) {
    routeRules.push({
      type: "logical",
      mode: "and",
      rules: [
        { domain_suffix: cnCdnSuffixes },
        { rule_set: ["geoip-cn"] },
      ],
      action: "route",
      outbound: "direct",
    });
  }
  config.route.rules.splice(3, 0, ...routeRules);
  return config;
}

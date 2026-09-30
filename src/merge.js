const INFO_NODE_PATTERN =
  /Remain|Expired|官网|如需|套餐|去除|剩余|距离|Reset|重置|流量|到期/i;

const NODE_TYPES = new Set([
  "anytls",
  "hysteria",
  "hysteria2",
  "http",
  "naive",
  "shadowsocks",
  "shadowtls",
  "socks",
  "ssh",
  "trojan",
  "tuic",
  "vless",
  "vmess",
  "wireguard",
]);

const REGION_MATCHERS = new Map([
  ["Hong Kong", /港|🇭🇰|香港|\bHK\b|Hong/i],
  ["Taiwan", /台|🇹🇼|台湾|Taiwan|Taipei|\bTW\b/i],
  ["Japan", /日|🇯🇵|日本|Japan|\bJP\b/i],
  ["Singapore", /坡|🇸🇬|新加坡|狮城|Singapore|\bSG\b/i],
  ["United States", /美|🇺🇸|美国|United States|American|\bUS\b/i],
  ["United Kingdom", /🇬🇧|英国|英格兰|United Kingdom|\bUK\b/i],
  ["Korea", /韩|🇰🇷|韩国|Korea|\bKR\b/i],
]);

const PROXY_CHOICES = [
  "Auto",
  "Hong Kong",
  "Taiwan",
  "Japan",
  "Singapore",
  "United States",
  "United Kingdom",
  "Korea",
];

function findOutbound(config, tag) {
  const outbound = config.outbounds.find((item) => item.tag === tag);
  if (!outbound) {
    throw new Error(`base config is missing outbound: ${tag}`);
  }
  return outbound;
}

function uniqueByTag(nodes) {
  const tags = new Set();
  for (const node of nodes) {
    if (!node.tag || typeof node.tag !== "string") {
      throw new Error("subscription contains a node without a tag");
    }
    if (tags.has(node.tag)) {
      throw new Error(`subscription contains a duplicate node tag: ${node.tag}`);
    }
    tags.add(node.tag);
  }
  return nodes;
}

function extractSubscriptionNodes(subscriptionConfig) {
  if (!Array.isArray(subscriptionConfig?.outbounds)) {
    throw new Error("subscription is not a complete sing-box configuration");
  }
  return uniqueByTag(
    subscriptionConfig.outbounds
      .filter((item) => NODE_TYPES.has(item.type))
      .filter((item) => !INFO_NODE_PATTERN.test(item.tag ?? ""))
      .map((item) => structuredClone(item)),
  );
}

function validateNodes(config, nodes) {
  if (nodes.length === 0) {
    throw new Error("subscription contains no usable proxy nodes");
  }
  const staticTags = new Set(config.outbounds.map((item) => item.tag));
  for (const node of nodes) {
    if (staticTags.has(node.tag)) {
      throw new Error(`node tag conflicts with a static outbound: ${node.tag}`);
    }
  }
}

function selectAutoNodes(nodeTags, regionTags) {
  const selected = [];

  const fallbackOrder = [
    ...regionTags.get("Hong Kong"),
    ...regionTags.get("Singapore"),
    ...regionTags.get("Taiwan"),
    ...regionTags.get("Japan"),
    ...regionTags.get("United States"),
    ...nodeTags,
  ];
  for (const tag of fallbackOrder) {
    if (selected.length >= 10) break;
    if (!selected.includes(tag)) selected.push(tag);
  }
  return selected;
}

export function mergeSubscription(baseConfig, subscriptionConfig) {
  const config = structuredClone(baseConfig);
  const nodes = extractSubscriptionNodes(subscriptionConfig);
  validateNodes(config, nodes);

  const nodeTags = nodes.map((item) => item.tag);
  const regionTags = new Map();
  for (const [groupTag, matcher] of REGION_MATCHERS) {
    const matches = nodeTags.filter((tag) => matcher.test(tag));
    regionTags.set(groupTag, matches);

    const group = findOutbound(config, groupTag);
    group.outbounds = matches.length > 0 ? matches : ["Auto"];
    if (!group.outbounds.includes(group.default)) {
      group.default = group.outbounds[0];
    }
  }

  const auto = findOutbound(config, "Auto");
  auto.outbounds = selectAutoNodes(nodeTags, regionTags);
  if (auto.outbounds.length === 0) {
    throw new Error("unable to select nodes for Auto");
  }

  const proxy = findOutbound(config, "Proxy");
  proxy.outbounds = [...PROXY_CHOICES, ...nodeTags];
  proxy.default = "Auto";

  config.outbounds.push(...nodes);
  return config;
}

export function mergeLinuxSubscription(baseConfig, subscriptionConfig) {
  const config = structuredClone(baseConfig);
  const nodes = extractSubscriptionNodes(subscriptionConfig);
  validateNodes(config, nodes);

  const nodeTags = nodes.map((item) => item.tag);
  const updateGroup = (tag, matcher) => {
    const group = findOutbound(config, tag);
    const matches = nodeTags.filter((nodeTag) => matcher.test(nodeTag));
    group.outbounds = matches.length > 0 ? matches : ["Auto"];
  };

  // Proxy node hostnames must resolve without the proxy itself.
  const nodeHosts = [...new Set(nodes.map((node) => node.server))]
    .filter((host) => typeof host === "string" && host && !/^[\d.]+$|:/.test(host));
  if (nodeHosts.length > 0) {
    config.dns.rules.splice(1, 0, { domain: nodeHosts, action: "route", server: "dns_direct" });
  }

  findOutbound(config, "Auto").outbounds = nodeTags;
  updateGroup("Auto-JP", REGION_MATCHERS.get("Japan"));
  updateGroup("Auto-SG", REGION_MATCHERS.get("Singapore"));
  updateGroup("Auto-US", REGION_MATCHERS.get("United States"));

  const proxy = findOutbound(config, "Proxy");
  proxy.outbounds = ["Auto", ...nodeTags, "DIRECT"];
  proxy.default = "Auto";

  config.outbounds.push(...nodes);
  return config;
}

export function subscriptionNodeCount(subscriptionConfig) {
  return subscriptionConfig.outbounds
    .filter((item) => NODE_TYPES.has(item.type))
    .filter((item) => !INFO_NODE_PATTERN.test(item.tag ?? "")).length;
}

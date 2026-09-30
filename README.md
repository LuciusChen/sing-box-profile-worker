# sing-box profile Worker

This Worker fetches a complete sing-box subscription, extracts usable proxy
nodes, and merges them into the iOS and Linux base profiles. The upstream URL
and profile access token are Cloudflare secrets and are not stored in source.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/LuciusChen/sing-box-profile-worker)

The base profiles in `src/` are a starting point tuned for mainland China
routing (iOS and Arch Linux). Fork and edit them to suit your needs. Your
subscription URL and access token live only in your own Cloudflare account;
never commit them.

## Quick start

1. Click the deploy button above (or fork, then `npm ci && npm run deploy`).
2. Set the two secrets in your Cloudflare account (the button prompts for them):

   ```shell
   npx wrangler secret put UPSTREAM_URL
   npx wrangler secret put ACCESS_TOKEN   # e.g. output of: openssl rand -hex 24
   ```

3. Import `https://<worker-domain>/<ACCESS_TOKEN>/config.json` (iOS) or
   `.../linux.json` (Linux) as a remote profile in sing-box.

For local development copy `.dev.vars.example` to `.dev.vars`.

## Secrets

- `UPSTREAM_URL`: upstream sing-box subscription URL.
- `ACCESS_TOKEN`: random token used in the profile path.

The iOS remote profile URL is:

```text
https://<worker-domain>/<ACCESS_TOKEN>/config.json
```

The existing iOS URL receives the current policy. It enables a dual-stack TUN,
prefers IPv4 without suppressing AAAA, uses encrypted AliDNS, and gives local
DNS names priority. No subscription URL change is needed.

Optional Cloudflare bindings for the iOS policy:

- `LOCAL_DNS_SUFFIXES`: comma-separated private DNS zones such as `home.example`.
- `CN_CDN_SUFFIXES`: comma-separated CDN domains to resolve through the local
  network; only a resulting China IP is explicitly routed direct. Leave unset
  until a specific CDN has been tested. This is not a universal CDN detector.

The Arch Linux profile URL is:

```text
https://<worker-domain>/<ACCESS_TOKEN>/linux.json
```

The Linux profile uses a shared HTTP client to download remote rule sets through
the `Proxy` selector and persists the DNS and rule-set caches. The host only
needs to periodically download and validate the main profile. Keep the private
profile URL in a root-readable file on the host; never commit it.

## Commands

```shell
npm ci
npm test
npx wrangler secret put UPSTREAM_URL
npx wrangler secret put ACCESS_TOKEN
npx wrangler deploy --dry-run
npm run deploy
```

Do not put secret values in `wrangler.jsonc` or commit local `.dev.vars*` /
`.env*` files (only the `*.example` templates are tracked).

## License

MIT

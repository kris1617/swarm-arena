// Patches Next.js's own compiled server code inside the standalone build
// output. Run this after `next build`, before packaging the Docker image.
//
// Root cause this fixes: self-hosted behind a reverse proxy (Caddy, per
// Caddyfile/deploy-plan.md), every request's internal absolute URL is built
// by NextServer from the server's own bind hostname/port — never from the
// real Host/X-Forwarded-Host header Caddy forwards — because
// `this.fetchHostname` ends up truthy no matter what HOSTNAME is set to
// (Next's own `startServer`/render-server bootstrap defaults a falsy
// hostname back to "localhost" several layers deep; there is no supported
// way to make it stay falsy). See `next-server.js`'s `initUrl` construction:
// it only falls back to the Host header when `fetchHostname` is falsy.
//
// This isn't cosmetic: Auth.js recomputes each OAuth provider's
// `callbackUrl` per-request from this same corrupted origin (see
// @auth/core/lib/utils/providers.js), so the token-exchange step sends
// GitHub a different `redirect_uri` than the one used for the initial
// authorize redirect (which is computed correctly, from request headers,
// by a different code path) — GitHub then rejects it as
// `redirect_uri_mismatch`, breaking every real sign-in.
//
// Fix: make `initUrl` prefer the real forwarded host/proto whenever the
// request actually carries one, falling back to the old bind-address
// behavior only when it doesn't (e.g. a direct, proxy-less request).
import { readFileSync, writeFileSync } from "node:fs";

const path =
	process.argv[2] ??
	".next/standalone/node_modules/next/dist/server/next-server.js";
const original = readFileSync(path, "utf8");

const initUrlPattern =
	/const initUrl = this\.fetchHostname && this\.port \? `\$\{protocol\}:\/\/\$\{this\.fetchHostname\}:\$\{this\.port\}\$\{req\.url\}` : this\.nextConfig\.experimental\.trustHostHeader \? `https:\/\/\$\{req\.headers\.host \|\| 'localhost'\}\$\{req\.url\}` : req\.url;/;

if (!initUrlPattern.test(original)) {
	throw new Error(
		`${path}: expected initUrl construction not found — Next.js's internal request-URL logic may have changed; update this patch script.`,
	);
}

const replacement = `const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host;
        const initUrl = forwardedHost ? \`\${req.headers['x-forwarded-proto'] || protocol || 'https'}://\${forwardedHost}\${req.url}\` : this.fetchHostname && this.port ? \`\${protocol}://\${this.fetchHostname}:\${this.port}\${req.url}\` : this.nextConfig.experimental.trustHostHeader ? \`https://\${req.headers.host || 'localhost'}\${req.url}\` : req.url;`;

const patched = original.replace(initUrlPattern, replacement);

writeFileSync(path, patched);
console.log(
	`Patched ${path}: initUrl now prefers the real forwarded Host/X-Forwarded-Host header over the server's own bind address.`,
);

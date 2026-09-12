# syntax=docker/dockerfile:1.7
#
# Dashboard image: build the SPA, then serve it via nginx with the
# control-plane API reverse-proxied (see nginx.conf).
#
# The typed API client comes from GitHub Packages, which is what package.json
# and package-lock.json already declare (@bifrost-compute/bifrost-client). This
# replaces an older vendored-copy dance that installed the client from
# ./vendor/bifrost-client to avoid needing npm auth; that path is gone because
# the package it named no longer exists, the directory it read was never
# tracked in git (so the build failed outside one developer's machine), and the
# script that generated it lives in the retired Rust repo. Overriding the
# dependency to a file: path also invalidated the lockfile, forcing a resolving
# `npm install` where `npm ci` belongs.
#
# GitHub Packages requires a token even for public packages (see .npmrc), so
# the build needs one — mounted as a BuildKit secret so it is never written to
# a layer or left in the image history:
#
#   docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN -t bifrost-ui:dev .
#   # with NODE_AUTH_TOKEN exported, e.g. export NODE_AUTH_TOKEN=$(gh auth token)
#
# Bases are pinned by digest so the image that ships is the image that was
# tested. Refresh a digest deliberately, in its own commit.

FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app

# Manifests first so a source-only change reuses the install layer. .npmrc is
# needed here too: it is what points @bifrost-compute at GitHub Packages.
COPY .npmrc package.json package-lock.json ./

# `npm ci` rather than `npm install`: it installs exactly the lockfile and
# fails if package.json and the lockfile disagree, which is the property the
# old vendor override destroyed.
RUN --mount=type=secret,id=node_auth_token \
    NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token 2>/dev/null || true)" \
    npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# nginx-unprivileged, not stock nginx, and the difference is not cosmetic.
#
# Stock nginx runs its master process as root and its entrypoint chowns
# /var/cache/nginx at startup, which needs CAP_CHOWN. A hardened deployment
# drops all capabilities — bifrost-pack's chart sets
# `capabilities: drop: ["ALL"]`, which is correct — and the container then dies
# before serving a byte:
#
#   nginx: [emerg] chown("/var/cache/nginx/client_temp", 101) failed
#                  (1: Operation not permitted)
#
# That is a CrashLoopBackOff on a real cluster, found by deploying it. The
# answer is an image that never needs the capability rather than a chart that
# hands it back: this variant runs as uid 101 with its cache dirs already
# owned, so nothing chowns anything.
#
# The port moves with it. An unprivileged process cannot bind :80 without
# CAP_NET_BIND_SERVICE, so this listens on 8080 — and that number has to move
# in lockstep everywhere it is named: nginx.conf's `listen`, any chart's
# containerPort, the Service targetPort, and any ConfigMap that overrides this
# conf. Applying only part of that set yields a silent 502 rather than a
# crash, which is harder to diagnose than the bug it replaces.
FROM nginxinc/nginx-unprivileged@sha256:d9083fe47768377ef55dedafd67d4da7c2f2bc2bece7554954f29359deb0dce9
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080

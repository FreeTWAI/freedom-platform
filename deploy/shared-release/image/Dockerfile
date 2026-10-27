# Build only from a tracked-source archive after main/CI admission. These bases
# are immutable; no credentials, checkout .git or private work enter the image.
FROM mirror.gcr.io/library/node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS node
FROM postgres:18@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN apt-get update && apt-get install --no-install-recommends -y ca-certificates git python3 libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && groupadd --gid 1001 release && useradd --uid 1001 --gid 1001 --no-create-home --home-dir /nonexistent release
WORKDIR /opt/freedom
COPY package.json package-lock.json LICENSE ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npm cache clean --force
# Source modules remain the separately reviewed controller, never the selected
# application's imports. Native tools and Node dependencies are image-owned.
COPY packages ./packages
COPY modules ./modules
COPY scripts ./scripts
COPY apps/platform-api ./apps/platform-api
COPY deploy/cloudflare ./deploy/cloudflare
COPY deploy/shared-release ./deploy/shared-release
COPY contracts ./contracts
COPY migrations ./migrations
RUN install -m 0555 deploy/shared-release/image/freedom-release /usr/local/bin/freedom-release \
    && mkdir -p /release/input /release/output /release/work /release/source \
    && chown 1001:1001 /release/output /release/work
USER 1001:1001
ENTRYPOINT ["/usr/local/bin/freedom-release"]

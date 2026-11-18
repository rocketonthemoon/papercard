# --- Stage 1: Build modern Svelte 5 frontend with Vite ---
FROM docker.io/library/node:22-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/src ./src
COPY frontend/public ./public
COPY frontend/index.html ./index.html
COPY frontend/vite.config.js ./vite.config.js
COPY frontend/svelte.config.js ./svelte.config.js
RUN npm run build

# --- Stage 2: Compile C Backend & Rust Engine ---
FROM docker.io/library/rust:1-alpine AS build
RUN apk add --no-cache musl-dev build-base sqlite-dev sqlite-static curl
WORKDIR /src

# Mongoose 7.14, pinned by checksum.
ARG MONGOOSE_VERSION=7.14
RUN curl -fsSLO https://raw.githubusercontent.com/cesanta/mongoose/${MONGOOSE_VERSION}/mongoose.c \
    && curl -fsSLO https://raw.githubusercontent.com/cesanta/mongoose/${MONGOOSE_VERSION}/mongoose.h \
    && echo "6fe98fabc6ffa917862eaa34210ceff7d93badedff076dd45fb3c78b1c915c2c  mongoose.c" | sha256sum -c - \
    && echo "8163329e6d06a140f9c0fa6d1a1f3ce382f18b5d2c5d963a7954bb8343cfc2b1  mongoose.h" | sha256sum -c -

# The engine: exercises, answer grading, duel scoring, Google sign-in.
COPY engine ./engine
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/engine/target \
    cd engine && CARGO_BUILD_JOBS=2 cargo build --release && cp target/release/libduelcore.a /src/

COPY server/main.c server/learn.c server/courses.c ./
RUN gcc -O2 -Wall -Wextra -static -o papercard main.c mongoose.c -Iengine libduelcore.a -lsqlite3 -lm \
    && strip papercard

# --- Stage 3: Minimal Production Image (no Node.js in runtime) ---
FROM docker.io/library/alpine:3.20
RUN adduser -D -H -u 10001 papercard && mkdir /data && chown papercard /data
COPY --from=build /src/papercard /usr/local/bin/papercard
COPY --from=frontend-build /app/dist /srv/web
COPY server/seed.json /srv/seed.json
USER papercard
EXPOSE 8000
ENV LISTEN=http://0.0.0.0:8000 WEB_ROOT=/srv/web DB_FILE=/data/papercard.sqlite MEMCACHED=memcached:11211
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:8000/api/config >/dev/null || exit 1
CMD ["papercard"]

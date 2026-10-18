# RawBoy Web, public build (LibRaw + Adobe DNG SDK), served by nginx.
# Build from the repo root: the web build uses ../shaders, ../luts and ../engine.
#   docker build -f web/Dockerfile -t rawboy-web .
#   docker run --rm -p 8080:80 rawboy-web      # http://localhost:8080

# --- 1. Native engine → WebAssembly (web/public/wasm/rawboy.mjs/.wasm) ---
FROM emscripten/emsdk:6.0.12 AS wasm
WORKDIR /src
COPY engine/src/main/cpp engine/src/main/cpp
COPY web/native web/native
# The Adobe DNG SDK (not in the repo; see third_party/README.md), for rawboy-full.wasm.
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/* \
 && mkdir -p third_party && cd third_party \
 && curl -fsSLO https://download.adobe.com/pub/adobe/dng/dng_sdk_1_7_1.zip \
 && unzip -q dng_sdk_1_7_1.zip && mv dng_sdk_1_7_1 dng_sdk && rm dng_sdk_1_7_1.zip
# Builds rawboy.wasm and rawboy-full.wasm. First build downloads LibRaw and jpegli.
RUN web/native/build.sh public

# --- 2. TypeScript/React → static dist/ ---
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY shaders /src/shaders
COPY luts /src/luts
COPY licenses /src/licenses
COPY engine/src/main/assets/models /src/engine/src/main/assets/models
COPY web/ ./
COPY --from=wasm /src/web/public/wasm public/wasm
# Same as `npm run build:public`, minus the WASM step done above.
RUN npx tsc --noEmit && npx vite build

# --- 3. Static server with the cross-origin isolation headers (threads need SharedArrayBuffer) ---
FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web /src/web/dist /usr/share/nginx/html
EXPOSE 80

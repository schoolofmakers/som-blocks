# som-compile: duinoapp-server (GPL-3.0, github.com/duinoapp/duinoapp-server)
# built from a pinned upstream commit. We run upstream as-is; nothing from it
# is vendored into this repo. The image adds the esp32 core (3.3.x, includes
# the ESP32-C3) that the 2021 Docker Hub image lacks.
#
# Build (amd64 only; arduino-cli and the toolchains are x86_64 Linux builds):
#   docker build --platform linux/amd64 -t som-compile:dev server/compile
FROM node:20-bookworm

# Upstream default branch is `master`; pin a full SHA so rebuilds are reproducible.
ARG DUINOAPP_REPO=https://github.com/duinoapp/duinoapp-server
ARG DUINOAPP_SHA=98bbc3009f2e1c008659bb4a99e8d5a0aa5fddf4

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

USER root

# python3-serial: esptool (bundled with the esp32 core) imports pyserial.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3-pip python3-serial \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# arduino-cli data, cores and the processed board/lib indexes live here
# (setup scripts hard-code this path and run with HOME=/mnt/duino-data).
RUN useradd --create-home --home-dir /home/duino duino \
 && mkdir -p /mnt/duino-data \
 && chmod 0777 /mnt/duino-data

WORKDIR /home/duino
USER duino

RUN git init -q . \
 && git remote add origin "${DUINOAPP_REPO}" \
 && git fetch -q --depth 1 origin "${DUINOAPP_SHA}" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${DUINOAPP_SHA}" \
 && rm -rf .git \
 && chmod +x setup/*.sh

RUN npm ci --omit=dev && npm cache clean --force

# Downloads arduino-cli, refreshes the indexes from setup/arduino-cli.yml
# (Arduino + esp8266 + Espressif), installs arduino:avr, esp8266:esp8266 and
# the latest esp32:esp32, lists board details, then pre-processes the data
# the API serves. Fail the build if the ESP32-C3 did not make it all the way
# through (stale index, old core, or boards processed before the install).
RUN node ./setup/docker-install.js \
 && HOME=/mnt/duino-data /mnt/duino-data/arduino-cli core list \
      --config-file /mnt/duino-data/arduino-cli.yml \
 && HOME=/mnt/duino-data /mnt/duino-data/arduino-cli core list \
      --config-file /mnt/duino-data/arduino-cli.yml | grep -E '^esp32:esp32 +3\.' \
 && grep -q '"fqbn":"esp32:esp32:esp32c3"' /mnt/duino-data/boards-processed.jsonl \
 && grep -q '"fqbn":"arduino:avr:uno"' /mnt/duino-data/boards-processed.jsonl

ENV PORT=3030 \
    SERVER_INFO_NAME="SoM Compile" \
    SERVER_INFO_OWNER="School of Makers" \
    SERVER_INFO_COUNTRY=CL \
    SERVER_INFO_LOCATION=Santiago

EXPOSE 3030
CMD ["node", "src/index.js"]

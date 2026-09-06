FROM debian:bookworm-slim

# Standard-Tools (Pflicht + sinnvoll)
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    bash coreutils findutils grep sed awk procps util-linux less \
    curl iproute2 dnsutils git \
    tar gzip zip unzip xz-utils jq \
    python3 python3-pip sudo ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Optional: Compiler / Node (via Build-Arg, standardmäßig aus)
ARG WITH_COMPILER=0
ARG WITH_NODE=0
RUN if [ "$WITH_COMPILER" = "1" ]; then \
      apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gcc g++ make; \
    fi \
    && if [ "$WITH_NODE" = "1" ]; then \
      apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs npm; \
    fi \
    && rm -rf /var/lib/apt/lists/*

# Dedizierter Sandbox-User
RUN useradd -m -s /bin/bash sandbox && echo 'sandbox ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/sandbox \
    && chmod 440 /etc/sudoers.d/sandbox

# Custom-Tool-Volumes (werden beim Start gemountet)
RUN mkdir -p /opt/custom-tools /opt/global-tools && chown -R sandbox:sandbox /opt

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /workspace
USER sandbox
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["sleep", "infinity"]

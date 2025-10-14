# Custom Bun image with git and openssh for GitLab CI
# Based on official oven/bun image with additional CI/CD dependencies

ARG BUN_VERSION=1.1.38
FROM oven/bun:${BUN_VERSION}

# Install git, openssh, and other CI dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Verify installations
RUN git --version && \
    ssh -V && \
    bun --version

# Set default working directory
WORKDIR /app

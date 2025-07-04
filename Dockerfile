# Multi-stage build for tools
FROM registry.redhat.io/openshift4/ose-tools-rhel9@sha256:22fd1559657a52b71229c2ae4b94f4a7db52b8058ac2aa73046302b1c4d73ac2 AS ose-tools

# Builder stage for ArgoCD CLI
FROM registry.access.redhat.com/ubi9/ubi:9.6-1751445649 AS builder

# Install ArgoCD CLI
RUN VERSION=$(curl -L -s https://raw.githubusercontent.com/argoproj/argo-cd/stable/VERSION) \
    && curl -sSL -o argocd-linux-amd64 https://github.com/argoproj/argo-cd/releases/download/v$VERSION/argocd-linux-amd64 \
    && install -m 555 argocd-linux-amd64 /usr/local/bin/argocd \
    && rm argocd-linux-amd64 \
    && argocd version --client

# Final stage
FROM registry.access.redhat.com/ubi9/nodejs-20:9.6-1750885770

LABEL name="tssc-test" \
      maintainers="TSSC Team"

# Set working directory
WORKDIR /tssc-test

# Copy tools from ose-tools stage
COPY --from=ose-tools /usr/bin/jq /usr/bin/kubectl /usr/bin/oc /usr/bin/vi /usr/bin/
# Copy required libraries for jq
COPY --from=ose-tools /usr/lib64/libjq.so.1 /usr/lib64/libonig.so.5 /usr/lib64/
# Copy vi libraries
COPY --from=ose-tools /usr/libexec/vi /usr/libexec/
# Copy ArgoCD CLI from builder stage
COPY --from=builder /usr/local/bin/argocd /usr/local/bin/argocd

# Verify tools installation (fail fast if tools are broken)
RUN echo "=== Verifying tool installations ===" && \
    jq --version && \
    kubectl version --client && \
    oc version --client && \
    argocd version --client && \
    echo "=== All tools verified successfully ==="

# Change ownership of working directory to default user
RUN chown -R 1001:0 /tssc-test && \
    chmod -R g+w /tssc-test

# Switch to non-root user for security
USER 1001

# Copy application source code with proper ownership
COPY --chown=1001:0 . .

# Install Node.js dependencies
RUN npm install && \
    npm cache clean --force

# Set environment variables
ENV KUBECONFIG=/tssc-test/.kube/config \
    NPM_CONFIG_CACHE=/tmp/.npm

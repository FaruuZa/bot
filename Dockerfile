# ==========================================
# Stage 1: Build dependencies
# ==========================================
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files only (for better layer caching)
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# ==========================================
# Stage 2: Final image
# ==========================================
FROM node:20-alpine

WORKDIR /app

# Add non-root user for security
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY src/ ./src/
COPY package.json ./

# Use non-root user
USER botuser

# Discord bot uses outbound WebSocket only, no inbound ports needed

CMD ["node", "src/index.js"]

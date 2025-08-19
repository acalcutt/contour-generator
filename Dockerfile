# Use an official Node.js runtime as a parent image
FROM node:22-slim AS builder

# Set the working directory in the container
WORKDIR /app

# Copy the application files to the container
COPY . .

# Install dependencies
RUN npm ci

# Create a new stage for the final image
FROM node:22-slim

# Create folder for data mapping and set ownership (as root)
RUN mkdir -p /data
VOLUME /data

# Copy all files from the builder stage
COPY --from=builder /app /app
WORKDIR /app

# Entrypoint to allow running commands
ENTRYPOINT ["/usr/local/bin/npm", "run", "generate-contours", "--"]

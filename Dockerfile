# Use an official Node.js runtime as a parent image
FROM node:22-slim

# Set the working directory in the container
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY patches/ ./patches/ 

# Build the TypeScript code
RUN npm run build

# Create folder for data mapping
RUN mkdir -p /data
VOLUME /data

# Make the built files executable
RUN chmod +x dist/index.js dist/generate-contour-tile-pyramid.js

# Install the package globally to make binaries available
RUN npm install -g .

# Set entrypoint to the main binary
ENTRYPOINT ["contour-generator"]
FROM node:22-alpine

WORKDIR /app

# Copy dependency definition files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application source code
COPY . .

# Ensure data directory exists for file persistence fallback
RUN mkdir -p /app/data

# Expose HTTP & WebSocket port
EXPOSE 3000

# Start backend server
CMD ["node", "server.js"]

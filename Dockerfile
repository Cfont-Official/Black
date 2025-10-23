FROM node:20-bullseye
RUN apt-get update && apt-get install -y chromium && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=10000
EXPOSE 10000
CMD ["npm", "start"]

FROM node:20-slim

# Install Python3 and FFmpeg required for yt-dlp-exec and MP3 conversion
RUN apt-get update && apt-get install -y \
    python3 \
    python-is-python3 \
    ffmpeg \
    && rm -rf /var/lib/apt-get/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]

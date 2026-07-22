
# Install FFmpeg, Python, and dependencies needed by yt-dlp
RUN apk add --no-cache ffmpeg python3 py3-pip && \
    ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]

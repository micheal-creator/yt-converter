const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const { exec } = require('yt-dlp-exec');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Regex to validate YouTube URLs
const YOUTUBE_URL_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+$/;

/**
 * 1. Fetch Metadata Endpoint
 */
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;

  if (!url || !YOUTUBE_URL_REGEX.test(url)) {
    return res.status(400).json({ error: 'Please provide a valid YouTube URL.' });
  }

  try {
    // Extract metadata using yt-dlp
    const output = await exec(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
    });

    const metadata = JSON.parse(output.stdout);

    res.json({
      title: metadata.title || 'Unknown Title',
      duration: metadata.duration || 0,
      thumbnail: metadata.thumbnail || '',
      uploader: metadata.uploader || 'Unknown Artist',
      availableBitrates: ['128k', '192k', '256k', '320k']
    });
  } catch (err) {
    console.error('Metadata extraction error:', err.message);
    res.status(500).json({ error: 'Failed to fetch video information. Please try again.' });
  }
});

/**
 * 2. Convert & Stream MP3 Endpoint
 */
app.post('/api/convert', async (req, res) => {
  const { url, bitrate = '192k' } = req.body;

  if (!url || !YOUTUBE_URL_REGEX.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL.' });
  }

  // Allowed bitrates defense
  const validBitrates = ['128k', '192k', '256k', '320k'];
  const targetBitrate = validBitrates.includes(bitrate) ? bitrate : '192k';

  try {
    // Get video title for download filename header
    const info = await exec(url, {
      dumpSingleJson: true,
      noWarnings: true,
    });
    const metadata = JSON.parse(info.stdout);
    const safeTitle = (metadata.title || 'audio').replace(/[^a-zA-Z0-9_\-\s]/g, '');

    // Configure response headers for download
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);

    // Spawn yt-dlp stream process
    const ytStream = exec(url, {
      output: '-',
      format: 'bestaudio/best',
      noWarnings: true,
    }, { stdio: ['ignore', 'pipe', 'ignore'] });

    // Pipe raw audio stream into FFmpeg -> stream MP3 back directly to res
    ffmpeg(ytStream.stdout)
      .audioCodec('libmp3lame')
      .audioBitrate(targetBitrate)
      .format('mp3')
      .on('error', (err) => {
        console.error('FFmpeg error:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Conversion failed during processing.' });
        }
      })
      .pipe(res, { end: true });

    // Handle client disconnection
    req.on('close', () => {
      ytStream.kill();
    });

  } catch (err) {
    console.error('Conversion setup error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to initiate audio stream.' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

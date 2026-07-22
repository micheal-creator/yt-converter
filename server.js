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

// Regex to validate YouTube URLs (videos, music, shorts, playlists)
const youtubeRegex = /^(https?:\/\/)?((www|music)\.)?(youtube\.com|youtu\.be)\/.+$/;

/**
 * 1. Fetch Metadata Endpoint (Handles Videos & Playlists)
 */
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;

  if (!url || !youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Please provide a valid YouTube URL.' });
  }

  try {
    // Extract metadata using yt-dlp (flatPlaylist ensures fast extraction for playlists)
    const output = await exec(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      flatPlaylist: true,
    });

    const metadata = JSON.parse(output.stdout);

    // If it's a playlist
    if (metadata._type === 'playlist' || Array.isArray(metadata.entries)) {
      return res.json({
        type: 'playlist',
        title: metadata.title || 'YouTube Playlist',
        itemCount: metadata.entries ? metadata.entries.length : 0,
        entries: (metadata.entries || []).map(entry => ({
          title: entry.title,
          url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`,
          duration: entry.duration || 0,
          uploader: entry.uploader || 'Unknown Artist'
        })),
        availableBitrates: ['128k', '192k', '256k', '320k']
      });
    }

    // Standard Single Video
    res.json({
      type: 'video',
      title: metadata.title || 'Unknown Title',
      duration: metadata.duration || 0,
      thumbnail: metadata.thumbnail || '',
      uploader: metadata.uploader || 'Unknown Artist',
      availableBitrates: ['128k', '192k', '256k', '320k']
    });
  } catch (err) {
    console.error('Metadata extraction error:', err.message);
    res.status(500).json({ error: 'Failed to fetch video/playlist information. Please try again.' });
  }
});

/**
 * 2. Convert & Stream MP3 Endpoint
 */
app.post('/api/convert', async (req, res) => {
  const { url, bitrate = '192k' } = req.body;

  if (!url || !youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL.' });
  }

  const validBitrates = ['128k', '192k', '256k', '320k'];
  const targetBitrate = validBitrates.includes(bitrate) ? bitrate : '192k';

  try {
    // Force single video processing for conversion even if a playlist link was passed
    const info = await exec(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noPlaylist: true
    });

    const metadata = JSON.parse(info.stdout);
    const safeTitle = (metadata.title || 'audio').replace(/[^a-zA-Z0-9_\-\s]/g, '');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);

    const ytStream = exec(url, {
      output: '-',
      format: 'bestaudio/best',
      noWarnings: true,
      noPlaylist: true
    }, { stdio: ['ignore', 'pipe', 'ignore'] });

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

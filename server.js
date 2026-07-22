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
    const output = await exec(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      flatPlaylist: true,
    });

    const metadata = JSON.parse(output.stdout);

    // If it's a playlist
    if (metadata._type === 'playlist' || Array.isArray(metadata.entries)) {
      const firstTrack = metadata.entries && metadata.entries[0] ? metadata.entries[0] : null;
      const playlistThumbnail = metadata.thumbnails?.[0]?.url || 
                                (firstTrack ? `https://i.ytimg.com/vi/${firstTrack.id}/hqdefault.jpg` : '');

      return res.json({
        type: 'playlist',
        title: metadata.title || 'YouTube Playlist',
        itemCount: metadata.entries ? metadata.entries.length : 0,
        thumbnail: playlistThumbnail,
        firstVideoUrl: firstTrack ? (firstTrack.url || `https://www.youtube.com/watch?v=${firstTrack.id}`) : url,
        uploader: metadata.uploader || metadata.channel || 'Playlist',
        availableBitrates: ['128k', '192k', '256k', '320k']
      });
    }

    // Standard Single Video / Music Track
    res.json({
      type: 'video',
      title: metadata.title || 'Unknown Title',
      duration: metadata.duration || 0,
      thumbnail: metadata.thumbnail || (metadata.id ? `https://i.ytimg.com/vi/${metadata.id}/hqdefault.jpg` : ''),
      uploader: metadata.uploader || metadata.artist || 'Unknown Artist',
      availableBitrates: ['128k', '192k', '256k', '320k']
    });
  } catch (err) {
    console.error('Metadata extraction error:', err.message);
    res.status(500).json({ error: 'Failed to fetch details. YouTube may be blocking the request.' });
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
    // 1. Fetch info with noPlaylist to extract single target video title & direct download link
    const info = await exec(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noPlaylist: true,
    });

    const metadata = JSON.parse(info.stdout);
    const safeTitle = (metadata.title || 'audio').replace(/[^a-zA-Z0-9_\-\s]/g, '');

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);

    // 2. Spawn yt-dlp binary stream strictly for a single track
    const ytStream = exec(url, {
      output: '-',
      format: 'bestaudio/best',
      noWarnings: true,
      noPlaylist: true,
      forceOverwrites: true,
    }, { stdio: ['ignore', 'pipe', 'pipe'] });

    // Handle yt-dlp stderr errors
    ytStream.stderr.on('data', (data) => {
      console.error(`yt-dlp stderr: ${data.toString()}`);
    });

    // 3. Pipe audio through FFmpeg MP3 encoder directly to browser
    ffmpeg(ytStream.stdout)
      .audioCodec('libmp3lame')
      .audioBitrate(targetBitrate)
      .format('mp3')
      .on('error', (err) => {
        console.error('FFmpeg streaming error:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Conversion failed during audio processing.' });
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

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

// Regex to validate YouTube & YouTube Music URLs
const youtubeRegex = /^(https?:\/\/)?((www|music)\.)?(youtube\.com|youtu\.be)\/.+$/;

// User-Agent & Extractor arguments to bypass YouTube Cloud IP blocks on Render
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const PLAYER_CLIENT = 'youtube:player_client=android,mweb';

// Helper to format duration in seconds to MM:SS
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

/**
 * 1. Fetch Metadata Endpoint (Analyzes URL and returns Track/Playlist table data)
 */
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;

  if (!url || !youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Please provide a valid YouTube or YouTube Music URL.' });
  }

  try {
    const output = await exec(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      flatPlaylist: true,
      userAgent: USER_AGENT,
      extractorArgs: PLAYER_CLIENT,
    });

    const metadata = JSON.parse(output.stdout);

    // Handle Playlist
    if (metadata._type === 'playlist' || Array.isArray(metadata.entries)) {
      const formattedEntries = (metadata.entries || []).map((entry, idx) => {
        let trackUrl = url;
        if (entry.id) {
          trackUrl = `https://www.youtube.com/watch?v=${entry.id}`;
        } else if (entry.url && entry.url.startsWith('http')) {
          trackUrl = entry.url;
        } else if (entry.url && entry.url.includes('watch?v=')) {
          const id = entry.url.split('watch?v=')[1].split('&')[0];
          trackUrl = `https://www.youtube.com/watch?v=${id}`;
        }

        const thumb = entry.id 
          ? `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg` 
          : (entry.thumbnails?.[0]?.url || '');

        return {
          id: entry.id || `track_${idx}`,
          title: entry.title || `Track ${idx + 1}`,
          uploader: entry.uploader || entry.channel || metadata.uploader || 'Unknown Artist',
          duration: formatDuration(entry.duration),
          thumbnail: thumb,
          url: trackUrl
        };
      });

      return res.json({
        type: 'playlist',
        title: metadata.title || 'YouTube Playlist',
        itemCount: formattedEntries.length,
        entries: formattedEntries,
        availableBitrates: ['128k', '192k', '256k', '320k']
      });
    }

    // Standard Single Video / Music Track
    const singleThumb = metadata.thumbnail || (metadata.id ? `https://i.ytimg.com/vi/${metadata.id}/hqdefault.jpg` : '');

    res.json({
      type: 'video',
      title: metadata.title || 'Unknown Title',
      itemCount: 1,
      entries: [{
        id: metadata.id || 'single_track',
        title: metadata.title || 'Unknown Title',
        uploader: metadata.uploader || metadata.artist || 'Unknown Artist',
        duration: formatDuration(metadata.duration),
        thumbnail: singleThumb,
        url: url
      }],
      availableBitrates: ['128k', '192k', '256k', '320k']
    });
  } catch (err) {
    console.error('Metadata extraction error:', err.message);
    res.status(500).json({ error: 'Failed to fetch details from YouTube.' });
  }
});

/**
 * 2. Convert & Stream Audio Endpoint
 */
app.post('/api/convert', async (req, res) => {
  const { url, title, bitrate = '192k' } = req.body;

  if (!url || !youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL.' });
  }

  const validBitrates = ['128k', '192k', '256k', '320k'];
  const targetBitrate = validBitrates.includes(bitrate) ? bitrate : '192k';
  const safeTitle = (title || 'audio').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim() || 'audio';

  try {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);

    // Stream single video directly without running pre-info command to prevent Cloud IP 403 blocks
    const ytStream = exec(url, {
      output: '-',
      format: 'bestaudio/best',
      noWarnings: true,
      noPlaylist: true,
      userAgent: USER_AGENT,
      extractorArgs: PLAYER_CLIENT,
    }, { stdio: ['ignore', 'pipe', 'pipe'] });

    ytStream.stderr.on('data', (data) => {
      console.error(`yt-dlp stderr: ${data.toString()}`);
    });

    ffmpeg(ytStream.stdout)
      .audioCodec('libmp3lame')
      .audioBitrate(targetBitrate)
      .format('mp3')
      .on('error', (err) => {
        console.error('FFmpeg streaming error:', err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Conversion failed.' });
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

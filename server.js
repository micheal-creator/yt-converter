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

// User-Agent string to bypass standard bot blocks
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Helper to format duration in seconds to MM:SS
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Extract YouTube Video ID
function extractVideoId(url) {
  if (!url) return '';
  if (url.includes('v=')) {
    return url.split('v=')[1].split('&')[0];
  } else if (url.includes('youtu.be/')) {
    return url.split('youtu.be/')[1].split('?')[0];
  }
  return '';
}

/**
 * Engine 1: yt-dlp with multiple player client strategies
 * Attempts several extractor args combinations to bypass YouTube blocks.
 */
async function tryYtDlpGetUrl(url) {
  const strategies = [
    { extractorArgs: 'youtube:player_client=ios' },
    { extractorArgs: 'youtube:player_client=tv' },
    { extractorArgs: 'youtube:player_client=mweb' },
    { extractorArgs: 'youtube:player_client=web' },
    { extractorArgs: 'youtube:player_client=web_creator' },
  ];

  for (const strategy of strategies) {
    try {
      const result = await exec(url, {
        getUrl: true,
        format: 'bestaudio/best',
        noWarnings: true,
        noPlaylist: true,
        userAgent: USER_AGENT,
        ...strategy,
      });
      const audioUrl = result.stdout ? result.stdout.trim() : '';
      if (audioUrl && audioUrl.startsWith('http')) {
        console.log(`yt-dlp succeeded with strategy: ${strategy.extractorArgs}`);
        return audioUrl;
      }
    } catch (err) {
      console.warn(`yt-dlp failed with ${strategy.extractorArgs}: ${err.message}`);
    }
  }
  return null;
}

/**
 * Engine 2: Failover to Piped / Invidious API instances
 */
async function tryFallbackAPIs(videoId) {
  const apiEndpoints = [
    // Piped API instances
    { url: `https://pipedapi.in.projectsegfau.lt/streams/${videoId}`, type: 'piped' },
    { url: `https://pipedapi.kavin.rocks/streams/${videoId}`, type: 'piped' },
    { url: `https://pipedapi.adminforge.de/streams/${videoId}`, type: 'piped' },
    { url: `https://api.piped.yt/streams/${videoId}`, type: 'piped' },
    // Invidious API instances
    { url: `https://inv.nadeko.net/api/v1/videos/${videoId}`, type: 'invidious' },
    { url: `https://invidious.privacyredirect.com/api/v1/videos/${videoId}`, type: 'invidious' },
  ];

  for (const endpoint of apiEndpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(endpoint.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const data = await response.json();

      if (endpoint.type === 'piped' && data.audioStreams && data.audioStreams.length > 0) {
        const stream = data.audioStreams[0];
        if (stream.url) {
          console.log(`Piped API succeeded: ${endpoint.url}`);
          return stream.url;
        }
      }

      if (endpoint.type === 'invidious' && data.adaptiveFormats) {
        const audioStreams = data.adaptiveFormats.filter(f => f.type && f.type.includes('audio'));
        if (audioStreams.length > 0 && audioStreams[0].url) {
          console.log(`Invidious API succeeded: ${endpoint.url}`);
          return audioStreams[0].url;
        }
      }
    } catch (e) {
      console.warn(`Fallback API failed (${endpoint.url}): ${e.message}`);
    }
  }

  return null;
}

/**
 * Engine 3: Direct yt-dlp with output template (bypasses URL extraction)
 * Downloads audio to a temp file and streams it back.
 */
async function tryYtDlpDirectDownload(url, bitrate) {
  const fs = require('fs');
  const os = require('os');
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `audio_${Date.now()}.%(ext)s`);

  return new Promise((resolve, reject) => {
    const command = `yt-dlp "${url}" --no-playlist --no-warnings \
      --extractor-args "youtube:player_client=ios" \
      -f "bestaudio/best" \
      --user-agent "${USER_AGENT}" \
      -o "${tmpFile}"`;

    const { spawn } = require('child_process');
    const proc = spawn('bash', ['-c', command]);

    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      if (code === 0) {
        // Find the downloaded file
        const dir = os.tmpdir();
        const files = fs.readdirSync(dir).filter(f => f.startsWith('audio_') && f.includes(Date.now().toString().slice(-6)));
        // Just use glob-like approach
        const allFiles = fs.readdirSync(dir).filter(f => f.startsWith('audio_'));
        let audioFile = null;
        if (allFiles.length > 0) {
          audioFile = path.join(dir, allFiles[0]);
        }

        if (audioFile && fs.existsSync(audioFile)) {
          resolve({ method: 'file', filePath: audioFile });
        } else {
          reject(new Error('yt-dlp download completed but no audio file found.'));
        }
      } else {
        reject(new Error(`yt-dlp direct download failed (code ${code}): ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Multi-Engine Audio Stream Resolver
 */
async function resolveAudioStreamUrl(url) {
  const videoId = extractVideoId(url);

  // Engine 1: yt-dlp with multiple player client strategies
  console.log('Trying Engine 1: yt-dlp direct URL extraction...');
  const ytDlpUrl = await tryYtDlpGetUrl(url);
  if (ytDlpUrl) return { method: 'stream', url: ytDlpUrl };

  // Engine 2: Fallback API instances
  if (videoId) {
    console.log('Trying Engine 2: Piped/Invidious fallback APIs...');
    const apiUrl = await tryFallbackAPIs(videoId);
    if (apiUrl) return { method: 'stream', url: apiUrl };
  }

  // Engine 3: Direct yt-dlp download to temp file
  console.log('Trying Engine 3: yt-dlp direct download...');
  try {
    const result = await tryYtDlpDirectDownload(url, '192k');
    return result;
  } catch (e) {
    console.warn('Engine 3 failed:', e.message);
  }

  throw new Error('All audio extraction engines failed. YouTube may be blocking this server IP.');
}

/**
 * 1. Fetch Metadata Endpoint (Analyzes URL and returns Track/Playlist table data)
 */
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;

  if (!url || !youtubeRegex.test(url)) {
    return res.status(400).json({ error: 'Please provide a valid YouTube or YouTube Music URL.' });
  }

  const strategies = [
    { extractorArgs: 'youtube:player_client=ios' },
    { extractorArgs: 'youtube:player_client=tv' },
    { extractorArgs: 'youtube:player_client=mweb' },
    { extractorArgs: 'youtube:player_client=web' },
    { extractorArgs: 'youtube:player_client=web_creator' },
  ];

  try {
    let metadata = null;
    let lastError = null;

    for (const strategy of strategies) {
      try {
        const output = await exec(url, {
          dumpSingleJson: true,
          noWarnings: true,
          noCallHome: true,
          flatPlaylist: true,
          userAgent: USER_AGENT,
          ...strategy,
        });
        metadata = JSON.parse(output.stdout);
        break;
      } catch (err) {
        lastError = err;
        console.warn(`Analyze failed with ${strategy.extractorArgs}: ${err.message}`);
      }
    }

    if (!metadata) {
      // Last resort: try Piped API for metadata
      const videoId = extractVideoId(url);
      if (videoId) {
        try {
          const pipedRes = await fetch(`https://pipedapi.in.projectsegfau.lt/streams/${videoId}`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(10000),
          });
          if (pipedRes.ok) {
            const pipedData = await pipedRes.json();
            metadata = {
              _type: 'video',
              id: videoId,
              title: pipedData.title || 'Unknown Title',
              uploader: pipedData.uploader || 'Unknown Artist',
              artist: pipedData.uploader || 'Unknown Artist',
              duration: pipedData.duration || 0,
              thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            };
          }
        } catch (e) {
          console.warn('Piped metadata fallback also failed:', e.message);
        }
      }
    }

    if (!metadata) {
      return res.status(500).json({ error: 'Failed to fetch details from YouTube. Please try again later.' });
    }

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
    res.status(500).json({ error: 'Failed to fetch details from YouTube. Please try again later.' });
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
    const streamResult = await resolveAudioStreamUrl(url);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);

    if (streamResult.method === 'stream') {
      // Stream directly from URL
      ffmpeg(streamResult.url)
        .inputOptions(['-user_agent', USER_AGENT])
        .audioCodec('libmp3lame')
        .audioBitrate(targetBitrate)
        .format('mp3')
        .on('error', (err) => {
          console.error('FFmpeg streaming error:', err.message);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Conversion failed during audio encoding.' });
          }
        })
        .pipe(res, { end: true });

    } else if (streamResult.method === 'file') {
      // Convert downloaded file
      const fs = require('fs');
      ffmpeg(streamResult.filePath)
        .audioCodec('libmp3lame')
        .audioBitrate(targetBitrate)
        .format('mp3')
        .on('error', (err) => {
          console.error('FFmpeg file conversion error:', err.message);
          // Cleanup temp file
          try { fs.unlinkSync(streamResult.filePath); } catch (e) {}
          if (!res.headersSent) {
            res.status(500).json({ error: 'Conversion failed during audio encoding.' });
          }
        })
        .on('end', () => {
          // Cleanup temp file
          try { fs.unlinkSync(streamResult.filePath); } catch (e) {}
        })
        .pipe(res, { end: true });
    }

  } catch (err) {
    console.error('Conversion setup error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to initiate audio stream. Please try again.' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

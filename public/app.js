const urlInput = document.getElementById('urlInput');
const searchBtn = document.getElementById('searchBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resultCard = document.getElementById('resultCard');
const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const uploader = document.getElementById('uploader');
const bitrateSelect = document.getElementById('bitrateSelect');
const errorMsg = document.getElementById('errorMsg');
const loader = document.getElementById('loader');

let currentUrl = '';

searchBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return showError('Please paste a YouTube URL.');

  hideError();
  resultCard.classList.add('hidden');
  loader.classList.remove('hidden');

  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    // Safely parse JSON or fall back if the response is not OK
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Server returned an invalid response. Please try again.');
    }

    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch video details.');
    }

    currentUrl = url;

    // Handle Playlist vs Single Video
    if (data.type === 'playlist') {
      thumbnail.src = 'https://via.placeholder.com/480x270?text=YouTube+Playlist';
      videoTitle.textContent = `${data.title} (${data.itemCount} tracks)`;
      uploader.textContent = 'Playlist';
    } else {
      thumbnail.src = data.thumbnail || '';
      videoTitle.textContent = data.title || 'Unknown Title';
      uploader.textContent = data.uploader || 'Unknown Channel';
    }

    // Populate Bitrate options
    bitrateSelect.innerHTML = '';
    (data.availableBitrates || ['128k', '192k', '256k', '320k']).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = `${b}ps`;
      if (b === '192k') opt.selected = true;
      bitrateSelect.appendChild(opt);
    });

    resultCard.classList.remove('hidden');
  } catch (err) {
    showError(err.message);
  } finally {
    loader.classList.add('hidden');
  }
});

downloadBtn.addEventListener('click', async () => {
  const bitrate = bitrateSelect.value;
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Converting...';

  try {
    const response = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentUrl, bitrate })
    });

    if (!response.ok) {
      let errMessage = 'Download failed.';
      try {
        const errData = await response.json();
        errMessage = errData.error || errMessage;
      } catch (e) {
        errMessage = 'Server error during conversion.';
      }
      throw new Error(errMessage);
    }

    // Extract filename from header or fallback
    const disposition = response.headers.get('Content-Disposition');
    let filename = 'audio.mp3';
    if (disposition && disposition.includes('filename=')) {
      filename = disposition.split('filename=')[1].replace(/"/g, '');
    }

    // Trigger browser file save from binary blob stream
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);

  } catch (err) {
    showError(err.message);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'Download MP3';
  }
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.textContent = '';
  errorMsg.classList.add('hidden');
}

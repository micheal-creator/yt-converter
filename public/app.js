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

let currentData = null;

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

    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Server returned an invalid response.');
    }

    if (!res.ok) {
      throw new Error(data.error || 'Failed to fetch video details.');
    }

    currentData = data;
    thumbnail.src = data.thumbnail || 'https://via.placeholder.com/480x270?text=No+Thumbnail';

    // Populate Bitrate options
    bitrateSelect.innerHTML = '';
    (data.availableBitrates || ['128k', '192k', '256k', '320k']).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = `${b}ps`;
      if (b === '192k') opt.selected = true;
      bitrateSelect.appendChild(opt);
    });

    // Remove existing playlist container if present
    let playlistContainer = document.getElementById('playlistContainer');
    if (playlistContainer) playlistContainer.remove();

    if (data.type === 'playlist') {
      videoTitle.textContent = `${data.title} (${data.itemCount} tracks)`;
      uploader.textContent = 'Playlist';

      // Build checklist UI
      playlistContainer = document.createElement('div');
      playlistContainer.id = 'playlistContainer';
      playlistContainer.style.marginTop = '15px';
      playlistContainer.style.textAlign = 'left';
      playlistContainer.style.maxHeight = '250px';
      playlistContainer.style.overflowY = 'auto';
      playlistContainer.style.border = '1px solid #333';
      playlistContainer.style.padding = '10px';
      playlistContainer.style.borderRadius = '8px';

      const selectAllHeader = document.createElement('div');
      selectAllHeader.style.marginBottom = '10px';
      selectAllHeader.style.fontWeight = 'bold';
      selectAllHeader.innerHTML = `
        <label style="cursor:pointer;">
          <input type="checkbox" id="selectAllCheckbox" checked> Select / Deselect All
        </label>
      `;
      playlistContainer.appendChild(selectAllHeader);

      data.entries.forEach((track, index) => {
        const itemRow = document.createElement('div');
        itemRow.style.display = 'flex';
        itemRow.style.alignItems = 'center';
        itemRow.style.gap = '10px';
        itemRow.style.margin = '6px 0';

        itemRow.innerHTML = `
          <input type="checkbox" class="track-checkbox" value="${track.url}" id="track-${index}" checked>
          <label for="track-${index}" style="cursor:pointer; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${index + 1}. ${track.title}
          </label>
        `;
        playlistContainer.appendChild(itemRow);
      });

      resultCard.appendChild(playlistContainer);

      document.getElementById('selectAllCheckbox').addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.track-checkbox');
        checkboxes.forEach(cb => cb.checked = e.target.checked);
      });

      downloadBtn.textContent = 'Download Selected MP3s';
    } else {
      videoTitle.textContent = data.title || 'Unknown Title';
      uploader.textContent = data.uploader || 'Unknown Channel';
      downloadBtn.textContent = 'Download MP3';
    }

    resultCard.classList.remove('hidden');
  } catch (err) {
    showError(err.message);
  } finally {
    loader.classList.add('hidden');
  }
});

downloadBtn.addEventListener('click', async () => {
  const bitrate = bitrateSelect.value;
  let urlsToDownload = [];

  if (currentData.type === 'playlist') {
    const selectedCheckboxes = document.querySelectorAll('.track-checkbox:checked');
    urlsToDownload = Array.from(selectedCheckboxes).map(cb => cb.value);

    if (urlsToDownload.length === 0) {
      return showError('Please select at least one track to download.');
    }
  } else {
    urlsToDownload = [currentData.url || urlInput.value.trim()];
  }

  hideError();
  downloadBtn.disabled = true;

  for (let i = 0; i < urlsToDownload.length; i++) {
    const targetUrl = urlsToDownload[i];
    downloadBtn.textContent = `Processing (${i + 1}/${urlsToDownload.length})...`;

    try {
      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, bitrate })
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

      const disposition = response.headers.get('Content-Disposition');
      let filename = `track_${i + 1}.mp3`;
      if (disposition && disposition.includes('filename=')) {
        filename = disposition.split('filename=')[1].replace(/"/g, '');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      if (urlsToDownload.length > 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (err) {
      showError(`Failed on item ${i + 1}: ${err.message}`);
      break;
    }
  }

  downloadBtn.disabled = false;
  downloadBtn.textContent = currentData.type === 'playlist' ? 'Download Selected MP3s' : 'Download MP3';
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.textContent = '';
  errorMsg.classList.add('hidden');
}

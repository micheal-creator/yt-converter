const urlInput = document.getElementById('urlInput');
const searchBtn = document.getElementById('searchBtn');
const resultCard = document.getElementById('resultCard');
const errorMsg = document.getElementById('errorMsg');
const loader = document.getElementById('loader');

let currentEntries = [];

searchBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return showError('Please paste a YouTube or YouTube Music URL.');

  hideError();
  resultCard.classList.add('hidden');
  resultCard.innerHTML = '';
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
      throw new Error(data.error || 'Failed to fetch details.');
    }

    currentEntries = data.entries || [];
    renderTrackTable(data);

  } catch (err) {
    showError(err.message);
  } finally {
    loader.classList.add('hidden');
  }
});

function renderTrackTable(data) {
  resultCard.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'table-container';

  const headerInfo = document.createElement('div');
  headerInfo.style.display = 'flex';
  headerInfo.style.justifyContent = 'space-between';
  headerInfo.style.alignItems = 'center';
  headerInfo.style.marginBottom = '15px';
  headerInfo.innerHTML = `
    <h3 style="margin:0;">${data.title} (${data.itemCount} ${data.itemCount === 1 ? 'track' : 'tracks'})</h3>
  `;
  container.appendChild(headerInfo);

  const table = document.createElement('table');
  table.className = 'music-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width: 40px;"><input type="checkbox" id="selectAllCb" checked></th>
        <th>Title</th>
        <th>Uploader</th>
        <th>Bitrate</th>
        <th>Duration</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="trackTableBody"></tbody>
  `;
  container.appendChild(table);

  const bottomBar = document.createElement('div');
  bottomBar.className = 'bottom-bar';
  bottomBar.innerHTML = `
    <span id="selectedCountText">Total: ${data.itemCount} | Selected: ${data.itemCount}</span>
    <button id="downloadSelectedBtn" class="primary-btn">↓ Download Selected</button>
  `;
  container.appendChild(bottomBar);

  resultCard.appendChild(container);
  resultCard.classList.remove('hidden');

  const tbody = document.getElementById('trackTableBody');
  data.entries.forEach((track, index) => {
    const tr = document.createElement('tr');
    tr.id = `row-${index}`;
    tr.innerHTML = `
      <td><input type="checkbox" class="track-cb" value="${index}" checked></td>
      <td class="title-cell">
        <img src="${track.thumbnail}" alt="" class="track-thumb">
        <span>${track.title}</span>
      </td>
      <td>${track.uploader}</td>
      <td>
        <select class="bitrate-select" id="bitrate-${index}">
          <option value="128k">128kbps</option>
          <option value="192k" selected>192kbps</option>
          <option value="256k">256kbps</option>
          <option value="320k">320kbps</option>
        </select>
      </td>
      <td>${track.duration}</td>
      <td>
        <button class="icon-btn download-single-btn" data-index="${index}" title="Download Track">↓</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const selectAllCb = document.getElementById('selectAllCb');
  const trackCbs = document.querySelectorAll('.track-cb');

  selectAllCb.addEventListener('change', (e) => {
    trackCbs.forEach(cb => cb.checked = e.target.checked);
    updateSelectedCount();
  });

  trackCbs.forEach(cb => {
    cb.addEventListener('change', () => {
      updateSelectedCount();
    });
  });

  document.querySelectorAll('.download-single-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = e.currentTarget.getAttribute('data-index');
      await downloadTrack(idx, e.currentTarget);
    });
  });

  document.getElementById('downloadSelectedBtn').addEventListener('click', async () => {
    const selectedIndices = Array.from(document.querySelectorAll('.track-cb:checked')).map(cb => cb.value);
    if (selectedIndices.length === 0) {
      return showError('Please select at least one track to download.');
    }

    const bulkBtn = document.getElementById('downloadSelectedBtn');
    bulkBtn.disabled = true;

    for (let i = 0; i < selectedIndices.length; i++) {
      const idx = selectedIndices[i];
      bulkBtn.textContent = `Downloading (${i + 1}/${selectedIndices.length})...`;
      const singleBtn = document.querySelector(`.download-single-btn[data-index="${idx}"]`);
      await downloadTrack(idx, singleBtn);
      if (i < selectedIndices.length - 1) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    bulkBtn.disabled = false;
    bulkBtn.textContent = '↓ Download Selected';
  });
}

function updateSelectedCount() {
  const selectedCount = document.querySelectorAll('.track-cb:checked').length;
  const totalCount = currentEntries.length;
  const countText = document.getElementById('selectedCountText');
  if (countText) {
    countText.textContent = `Total: ${totalCount} | Selected: ${selectedCount}`;
  }
}

async function downloadTrack(index, btnElement) {
  const track = currentEntries[index];
  const bitrateSelect = document.getElementById(`bitrate-${index}`);
  const bitrate = bitrateSelect ? bitrateSelect.value : '192k';

  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = '⌛';
  }

  try {
    const response = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: track.url,
        title: track.title,
        bitrate: bitrate
      })
    });

    if (!response.ok) {
      let errMessage = 'Download failed.';
      try {
        const errData = await response.json();
        errMessage = errData.error || errMessage;
      } catch (e) {
        errMessage = 'Stream failed.';
      }
      throw new Error(errMessage);
    }

    const disposition = response.headers.get('Content-Disposition');
    let filename = `${track.title}.mp3`;
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

    if (btnElement) btnElement.textContent = '✓';
  } catch (err) {
    showError(`Failed to download "${track.title}": ${err.message}`);
    if (btnElement) btnElement.textContent = '✕';
  } finally {
    if (btnElement) btnElement.disabled = false;
  }
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function hideError() {
  errorMsg.textContent = '';
  errorMsg.classList.add('hidden');
}

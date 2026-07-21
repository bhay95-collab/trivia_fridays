export function isSupportedMediaType(value) {
  return ['audio', 'image', 'video'].includes(String(value || '').toLowerCase());
}

export function normalizeMediaEntry(entry) {
  const type = String(entry?.media_type || '').toLowerCase();
  const normalizedType = isSupportedMediaType(type) ? type : 'image';

  return {
    id: entry?.id || null,
    media_type: normalizedType,
    source_type: entry?.source_type || 'url',
    url: entry?.url || '',
    caption: entry?.caption || '',
    sort_order: Number(entry?.sort_order || 0),
  };
}

export function mediaRendererMarkup(media = []) {
  return (media || []).map((item) => {
    const normalized = normalizeMediaEntry(item);
    const safeCaption = String(normalized.caption || '').replace(/[<>&"']/g, (char) => ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));

    if (normalized.media_type === 'audio') {
      return `
        <div class="media-card media-card-audio">
          <div class="media-label">Audio</div>
          ${safeCaption ? `<p class="media-caption">${safeCaption}</p>` : ''}
          <audio controls preload="metadata" src="${normalized.url}"></audio>
        </div>`;
    }

    if (normalized.media_type === 'video') {
      return `
        <div class="media-card media-card-video">
          <div class="media-label">Video</div>
          ${safeCaption ? `<p class="media-caption">${safeCaption}</p>` : ''}
          <video controls preload="metadata" src="${normalized.url}"></video>
        </div>`;
    }

    return `
      <div class="media-card media-card-image">
        <div class="media-label">Image</div>
        ${safeCaption ? `<p class="media-caption">${safeCaption}</p>` : ''}
        <img src="${normalized.url}" alt="${safeCaption || 'Question media'}">
      </div>`;
  }).join('');
}

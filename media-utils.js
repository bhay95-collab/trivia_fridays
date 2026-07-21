export function isSupportedMediaType(value) {
  return ['audio', 'image', 'video'].includes(String(value || '').toLowerCase());
}

export function isSafeMediaUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function escapeHtml(value) {
  return String(value || '').replace(/[<>&"']/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

export function normalizeMediaEntry(entry) {
  const type = String(entry?.media_type || '').toLowerCase();
  const normalizedType = isSupportedMediaType(type) ? type : 'image';

  return {
    id: entry?.id || null,
    media_type: normalizedType,
    source_type: 'url',
    url: String(entry?.url || '').trim(),
    caption: entry?.caption || '',
    sort_order: Number(entry?.sort_order || 0),
  };
}

export function mediaRendererMarkup(media = []) {
  return (media || []).filter((item) => isSafeMediaUrl(item?.url)).map((item) => {
    const normalized = normalizeMediaEntry(item);
    const safeCaption = escapeHtml(normalized.caption);
    const safeUrl = escapeHtml(normalized.url);

    if (normalized.media_type === 'audio') {
      return `
        <div class="media-card media-card-audio">
          <div class="media-label">Audio</div>
          ${safeCaption ? `<p class="media-caption">${safeCaption}</p>` : ''}
          <audio controls preload="metadata" src="${safeUrl}"></audio>
        </div>`;
    }

    if (normalized.media_type === 'video') {
      return `
        <div class="media-card media-card-video">
          <div class="media-label">Video</div>
          ${safeCaption ? `<p class="media-caption">${safeCaption}</p>` : ''}
          <video controls preload="metadata" src="${safeUrl}"></video>
        </div>`;
    }

    return `
      <div class="media-card media-card-image">
        <div class="media-label">Image</div>
        ${safeCaption ? `<p class="media-caption">${safeCaption}</p>` : ''}
        <img src="${safeUrl}" alt="${safeCaption || 'Question media'}">
      </div>`;
  }).join('');
}

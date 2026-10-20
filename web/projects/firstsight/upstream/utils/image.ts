const IMAGE_EXTENSIONS = /\.(avif|gif|jpe?g|png|webp)(\?.*)?$/i;
const STATIC_IMAGE_EXTENSIONS = /\.(avif|jpe?g|png|webp)(\?.*)?$/i;

interface CompressionOptions {
  width?: number;
  quality?: number;
}

const splitUrl = (url: string) => {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutHash.indexOf('?');
  return {
    path: queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash,
    query: queryIndex >= 0 ? withoutHash.slice(queryIndex) : '',
    hash,
  };
};

const isLocalPublicImage = (url: string) => {
  return url.startsWith('/') && !url.startsWith('//') && STATIC_IMAGE_EXTENSIONS.test(url);
};

export const getOptimizedLocalImageUrl = (url: string) => {
  const { path } = splitUrl(url);
  const withoutExtension = path.replace(/\.[^.\/]+$/i, '');
  return encodeURI(`/optimized${withoutExtension}.webp`);
};

export const getCompressedImageUrl = (url?: string, options: CompressionOptions = {}) => {
  if (!url) return url;
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (!IMAGE_EXTENSIONS.test(url)) return url;

  const width = options.width ?? 1200;
  const quality = options.quality ?? 72;

  if (isLocalPublicImage(url)) {
    return getOptimizedLocalImageUrl(url);
  }

  try {
    const parsed = new URL(url, window.location.origin);

    if (parsed.hostname.includes('images.unsplash.com')) {
      parsed.searchParams.set('auto', 'format');
      parsed.searchParams.set('fit', 'max');
      parsed.searchParams.set('w', String(width));
      parsed.searchParams.set('q', String(quality));
      return parsed.toString();
    }

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const source = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
      return `https://images.weserv.nl/?url=${encodeURIComponent(source)}&w=${width}&q=${quality}&output=webp`;
    }
  } catch {
    return url;
  }

  return url;
};

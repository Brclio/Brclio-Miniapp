import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface OriginalImageProps {
  src: string;
  alt: string;
  available?: boolean;
  width?: number;
  height?: number;
  loading?: 'eager' | 'lazy';
  variant?: 'cover' | 'photo' | 'lightbox';
}

export function OriginalImage({ src, alt, available = true, width, height, loading, variant = 'photo' }: OriginalImageProps) {
  const [failedSource, setFailedSource] = useState('');
  const unavailable = !available || !src || failedSource === src;
  return (
    <span className={`image-frame image-frame--${variant}${unavailable ? ' image-frame--unavailable' : ''}`}>
      {unavailable ? (
        <span className="unavailable-image" role="img" aria-label={`${alt}，图片暂不可用`}>
          <ImageOff size={28} strokeWidth={1.25} aria-hidden="true" />
          <span>图片暂不可用</span>
          <small>保留原照片说明</small>
        </span>
      ) : (
        <img src={src} alt={alt} width={width} height={height} loading={loading} onError={() => setFailedSource(src)} />
      )}
    </span>
  );
}

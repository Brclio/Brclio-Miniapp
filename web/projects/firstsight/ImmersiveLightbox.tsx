// Adapted from AndersonHJB/FirstSight components/ImmersiveLightbox.tsx.
// Public photography slice: image viewing only; no download, sharing or personal metadata.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Photo } from './types';
import { OriginalImage } from './OriginalImage';

interface ImmersiveLightboxProps {
  photo: Photo;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
  position: string;
}

export function ImmersiveLightbox({
  photo, onClose, onNext, onPrev, hasNext, hasPrev, position,
}: ImmersiveLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);

  // Preserve the source project's immersive view and mobile scroll restoration.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollY = window.scrollY;
    const originalStyle = document.body.style.cssText;
    const shell = document.getElementById('app-shell');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    shell?.setAttribute('inert', '');
    shell?.setAttribute('aria-hidden', 'true');
    return () => {
      shell?.removeAttribute('inert');
      shell?.removeAttribute('aria-hidden');
      document.body.style.cssText = originalStyle;
      window.scrollTo(0, scrollY);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight' && hasNext) {
        event.preventDefault();
        onNext();
      } else if (event.key === 'ArrowLeft' && hasPrev) {
        event.preventDefault();
        onPrev();
      } else if (event.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, onNext, onPrev, hasNext, hasPrev]);

  return createPortal(
    <div
      ref={dialogRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lightbox-title"
      aria-describedby="lightbox-description"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        if (touchStartX.current === null) return;
        const diff = touchStartX.current - event.changedTouches[0].clientX;
        if (diff > 50 && hasNext) onNext();
        else if (diff < -50 && hasPrev) onPrev();
        touchStartX.current = null;
      }}
      onTouchCancel={() => { touchStartX.current = null; }}
    >
      <div className="lightbox-toolbar">
        <span className="lightbox-position" aria-live="polite">{position}</span>
        <button ref={closeRef} className="icon-button lightbox-close" onClick={onClose} aria-label="关闭大图">
          <X size={25} strokeWidth={1.5} />
        </button>
      </div>
      <div className="lightbox-image-wrap" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <OriginalImage src={photo.url} alt={photo.alt} available={photo.available} width={photo.width} height={photo.height} variant="lightbox" />
      </div>
      {hasPrev && <button className="icon-button lightbox-prev" onClick={onPrev} aria-label="上一张"><ChevronLeft size={32} /></button>}
      {hasNext && <button className="icon-button lightbox-next" onClick={onNext} aria-label="下一张"><ChevronRight size={32} /></button>}
      <div className="lightbox-caption">
        <div className="lightbox-caption-heading">
          <h2 id="lightbox-title">{photo.title}</h2>
          {photo.date && <span className="photo-date">{photo.date}</span>}
        </div>
        <p id="lightbox-description">{photo.description}</p>
        {photo.location && <p className="photo-location">{photo.location}</p>}
        <div className="photo-tags">{photo.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      </div>
    </div>, document.body,
  );
}

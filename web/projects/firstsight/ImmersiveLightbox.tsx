// Adapted from AndersonHJB/FirstSight components/ImmersiveLightbox.tsx.
// Public photography slice: image viewing only; no download, sharing or personal metadata.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react';
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
  const dragStart = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [zoomedPhotoId, setZoomedPhotoId] = useState('');
  const zoomed = zoomedPhotoId === photo.id;

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
        setZoomedPhotoId('');
        onNext();
      } else if (event.key === 'ArrowLeft' && hasPrev) {
        event.preventDefault();
        setZoomedPhotoId('');
        onPrev();
      } else if ((event.key === '+' || event.key === '=') && photo.available) {
        event.preventDefault();
        setZoomedPhotoId(photo.id);
      } else if (event.key === '-' || event.key === '0') {
        event.preventDefault();
        setZoomedPhotoId('');
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
  }, [onClose, onNext, onPrev, hasNext, hasPrev, photo.id, photo.available]);

  return createPortal(
    <div
      ref={dialogRef}
      className={`lightbox${zoomed ? ' lightbox--zoomed' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="lightbox-title"
      aria-describedby="lightbox-description"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onTouchStart={(event) => { touchStartX.current = !zoomed && event.touches.length === 1 ? event.touches[0]?.clientX ?? null : null; }}
      onTouchEnd={(event) => {
        if (touchStartX.current === null || !event.changedTouches[0]) return;
        const diff = touchStartX.current - event.changedTouches[0].clientX;
        if (diff > 50 && hasNext) { setZoomedPhotoId(''); onNext(); }
        else if (diff < -50 && hasPrev) { setZoomedPhotoId(''); onPrev(); }
        touchStartX.current = null;
      }}
      onTouchCancel={() => { touchStartX.current = null; }}
    >
      <div className="lightbox-toolbar">
        <span className="lightbox-position" aria-live="polite"><span>FIRSTSIGHT</span> {position}</span>
        <div className="lightbox-actions"><button className="icon-button" disabled={!photo.available} onClick={() => setZoomedPhotoId(zoomed ? '' : photo.id)} aria-label={zoomed ? '还原图片大小' : '放大图片'} aria-pressed={zoomed}>{zoomed ? <ZoomOut size={22} strokeWidth={1.5} /> : <ZoomIn size={22} strokeWidth={1.5} />}</button><button ref={closeRef} className="icon-button lightbox-close" onClick={onClose} aria-label="关闭大图"><X size={25} strokeWidth={1.5} /></button></div>
      </div>
      <div className="lightbox-image-wrap"
        onClick={(event) => { if (event.target === event.currentTarget && !zoomed) onClose(); }}
        onDoubleClick={() => { if (photo.available) setZoomedPhotoId(zoomed ? '' : photo.id); }}
        onPointerDown={(event) => {
          if (!zoomed || event.pointerType !== 'mouse' || event.button !== 0) return;
          event.preventDefault();
          dragStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = dragStart.current;
          if (!start || start.pointerId !== event.pointerId) return;
          event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
          event.currentTarget.scrollTop = start.top + start.y - event.clientY;
        }}
        onPointerUp={() => { dragStart.current = null; }}
        onPointerCancel={() => { dragStart.current = null; }}
      >
        <OriginalImage src={photo.url} alt={photo.alt} available={photo.available} width={photo.width} height={photo.height} variant="lightbox" />
      </div>
      {hasPrev && <button className="icon-button lightbox-prev" onClick={() => { setZoomedPhotoId(''); onPrev(); }} aria-label="上一张"><ChevronLeft size={32} /></button>}
      {hasNext && <button className="icon-button lightbox-next" onClick={() => { setZoomedPhotoId(''); onNext(); }} aria-label="下一张"><ChevronRight size={32} /></button>}
      <div className="lightbox-caption">
        <div className="lightbox-caption-heading">
          <h2 id="lightbox-title">{photo.title}</h2>
          {photo.date && <span className="photo-date">{photo.date}</span>}
        </div>
        <p id="lightbox-description">{photo.description}</p>
        {photo.location && <p className="photo-location">{photo.location}</p>}
        <div className="photo-tags">{photo.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <span className="lightbox-help">{zoomed ? '拖动或滑动查看 · − 还原' : photo.available ? '左右切换 · 双击放大 · Esc 关闭' : '左右切换 · Esc 关闭'}</span>
      </div>
    </div>, document.body,
  );
}

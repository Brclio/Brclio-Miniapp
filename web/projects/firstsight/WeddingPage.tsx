// Adapted from AndersonHJB/FirstSight pages/WeddingPage.tsx.
// Retains collection → series detail → immersive image navigation.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Aperture, Image } from 'lucide-react';
import { PHOTO_COUNT, UNAVAILABLE_COUNT, WEDDING_COLLECTIONS } from './data';
import { ImmersiveLightbox } from './ImmersiveLightbox';
import { OriginalImage } from './OriginalImage';

function readAlbumId() {
  const match = window.location.hash.match(/^#\/album\/([a-z0-9-]+)$/);
  return match?.[1] || '';
}

export function WeddingPage() {
  const [albumId, setAlbumId] = useState(readAlbumId);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(-1);
  const selectedSeries = WEDDING_COLLECTIONS.find((series) => series.id === albumId) || null;
  const closeLightbox = useCallback(() => setSelectedPhotoIndex(-1), []);
  const handleNext = useCallback(() => {
    setSelectedPhotoIndex((index) => selectedSeries ? Math.min(index + 1, selectedSeries.photos.length - 1) : -1);
  }, [selectedSeries]);
  const handlePrev = useCallback(() => setSelectedPhotoIndex((index) => Math.max(index - 1, 0)), []);

  useEffect(() => {
    function onHashChange() {
      setSelectedPhotoIndex(-1);
      setAlbumId(readAlbumId());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = selectedSeries ? `${selectedSeries.title} · FirstSight 摄影` : 'FirstSight 摄影 · Brclio 口袋';
  }, [selectedSeries]);

  if (!selectedSeries) {
    return (
      <main id="main-content" className="collection-page" tabIndex={-1}>
        <section className="collection-intro" aria-labelledby="collection-title">
          <div className="intro-heading">
            <span className="section-kicker"><Aperture size={16} strokeWidth={1.5} /> FIRSTSIGHT · PHOTO ALBUMS</span>
            <h1 id="collection-title">光影里，都是生活</h1>
          </div>
          <div className="intro-note">
            <p>从日常、家庭到远方，沿着 FirstSight 的相册慢慢翻看。</p>
            <span className="album-summary">{WEDDING_COLLECTIONS.length} 本相册 · {PHOTO_COUNT} 张照片</span>
          </div>
        </section>

        <section className="collections-grid" aria-label="摄影相册">
          {WEDDING_COLLECTIONS.map((series, index) => (
            <article className="collection" key={series.id}>
              <button className="collection-open" onClick={() => { window.location.hash = `/album/${series.id}`; }} aria-label={`浏览${series.title}，${series.photos.length} 张照片`}>
                <span className="book-cover">
                  <OriginalImage src={series.cover} alt={`${series.title}相册封面`} loading={index < 3 ? 'eager' : 'lazy'} variant="cover" />
                  <span className="cover-action">翻开这册影集 <ArrowUpRight size={17} /></span>
                </span>
                <span className="collection-meta">
                  <span className="collection-subtitle">{series.subtitle}</span>
                  <span className="collection-title">{series.title}</span>
                  <span className="collection-count"><Image size={13} /> {series.photos.length} 张照片</span>
                </span>
              </button>
            </article>
          ))}
        </section>
        {UNAVAILABLE_COUNT > 0 && <p className="collection-disclaimer">部分图片暂不可用，已保留原相册的位置与说明。</p>}
      </main>
    );
  }

  return (
    <main id="main-content" className="series-page" tabIndex={-1}>
      <nav className="series-nav" aria-label="相册导航">
        <button className="text-button" onClick={() => { window.location.hash = '/'; }}><ArrowLeft size={18} /> 返回全部相册</button>
        <span className="series-nav-title">{selectedSeries.title}</span>
        <span className="album-summary">{selectedSeries.photos.length} 张照片</span>
      </nav>

      <section className="series-intro" aria-labelledby="series-title">
        <Aperture className="series-symbol" size={34} strokeWidth={1} aria-hidden="true" />
        <p className="section-kicker">{selectedSeries.subtitle}</p>
        <h1 id="series-title">{selectedSeries.title}</h1>
        {selectedSeries.description && <p className="series-description">{selectedSeries.description}</p>}
        {selectedSeries.photos.some((photo) => !photo.available) && <p className="series-notice">部分图片暂不可用，仍可查看原有文字记录。</p>}
      </section>

      <section className="series-photos" aria-label={`${selectedSeries.title}影像`}>
        {selectedSeries.photos.map((photo, index) => (
          <button className="series-photo" key={photo.id} onClick={() => setSelectedPhotoIndex(index)} aria-label={`查看${photo.title}${photo.available ? '大图' : '的文字记录，图片暂不可用'}`}>
            <span className="series-photo-image">
              <OriginalImage src={photo.url} alt={photo.alt} available={photo.available} width={photo.width} height={photo.height} loading="lazy" />
              <span className="photo-view-hint"><Image size={16} /> {photo.available ? '查看大图' : '查看记录'}</span>
            </span>
            <span className="series-photo-title">{photo.title}</span>
          </button>
        ))}
      </section>
      <p className="series-end">这一册看到这里，下一册再相遇。</p>

      {selectedPhotoIndex >= 0 && selectedSeries.photos[selectedPhotoIndex] && (
        <ImmersiveLightbox
          photo={selectedSeries.photos[selectedPhotoIndex]}
          onClose={closeLightbox}
          onNext={handleNext}
          onPrev={handlePrev}
          hasNext={selectedPhotoIndex < selectedSeries.photos.length - 1}
          hasPrev={selectedPhotoIndex > 0}
          position={`${selectedPhotoIndex + 1} / ${selectedSeries.photos.length}`}
        />
      )}
    </main>
  );
}

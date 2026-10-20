// Photography collection UI for the FirstSight_Online source albums.
// Retains collection → series detail → immersive image navigation.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Image, MoveUpRight } from 'lucide-react';
import { PHOTO_COUNT, UNAVAILABLE_COUNT, WEDDING_COLLECTIONS } from './data';
import { ImmersiveLightbox } from './ImmersiveLightbox';
import { OriginalImage } from './OriginalImage';

function readAlbumId() {
  const match = window.location.hash.match(/^#\/album\/([a-z0-9-]+)$/);
  return match?.[1] || '';
}

const CATEGORIES = [
  { id: 'all', label: '全部', accepts: (_category: string) => true },
  { id: 'wedding', label: '婚纱', accepts: (category: string) => category === 'wedding' },
  { id: 'pregnancy', label: '孕期', accepts: (category: string) => category === 'pregnancy' },
];

export function WeddingPage() {
  const [albumId, setAlbumId] = useState(readAlbumId);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(-1);
  const [categoryId, setCategoryId] = useState('all');
  const selectedSeries = WEDDING_COLLECTIONS.find((series) => series.id === albumId) || null;
  const category = CATEGORIES.find((item) => item.id === categoryId) || CATEGORIES[0];
  const visibleCollections = WEDDING_COLLECTIONS.filter((series) => category.accepts(series.category));
  const featuredSeries = WEDDING_COLLECTIONS.find((series) => series.id === 'ws1') || WEDDING_COLLECTIONS[0];
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
    document.title = selectedSeries ? `${selectedSeries.title} · FirstSight 摄影` : 'FirstSight 摄影 · Brclio 悦创';
  }, [selectedSeries]);

  if (!selectedSeries) {
    return (
      <main id="main-content" className="collection-page" tabIndex={-1}>
        <section className="collection-intro" aria-labelledby="collection-title">
          <div className="intro-heading">
            <span className="section-kicker"><span className="kicker-dot" /> THROUGH MY LENS</span>
            <h1 id="collection-title">把日常，<br />看成<span className="title-accent">风景</span>。</h1>
          </div>
          <div className="intro-note">
            <p>婚纱里的约定，孕期里的期待。<br />一些不想忘记的瞬间，收在这里。</p>
            <span className="album-summary"><span className="summary-albums"><strong>{WEDDING_COLLECTIONS.length}</strong> 本相册</span><span className="summary-divider">／</span><span>{PHOTO_COUNT} 张影像</span></span>
          </div>
        </section>

        <a className="featured-album" href={`#/album/${featuredSeries.id}`} aria-label={`翻开${featuredSeries.title}`}>
          <span className="featured-image"><OriginalImage src={featuredSeries.cover} alt={`${featuredSeries.title}精选影像`} loading="eager" variant="cover" /></span>
          <span className="featured-caption"><span><span className="featured-label">FIRSTSIGHT JOURNAL</span><span className="featured-title">一眼喜欢，便值得记录。</span></span><span className="featured-cta">翻开影集 <ArrowUpRight size={21} strokeWidth={1.5} /></span></span>
        </a>

        <div className="collection-toolbar">
          <div className="collection-section-heading"><h2>慢慢翻看</h2><span>THE ALBUMS</span></div>
          <div className="album-filters" role="group" aria-label="筛选相册主题">
            {CATEGORIES.map((item) => <button key={item.id} className={`album-filter${categoryId === item.id ? ' is-active' : ''}`} aria-pressed={categoryId === item.id} onClick={() => setCategoryId(item.id)}>{item.label}<sup>{WEDDING_COLLECTIONS.filter((series) => item.accepts(series.category)).length}</sup></button>)}
          </div>
        </div>

        <section className="collections-grid" aria-label={`${category.label}摄影相册`}>
          {visibleCollections.map((series) => (
            <article className="collection" key={series.id}>
              <button className="collection-open" onClick={() => { window.location.hash = `/album/${series.id}`; }} aria-label={`浏览${series.title}，${series.photos.length} 张照片`}>
                <span className="book-cover">
                  <OriginalImage src={series.cover} alt={`${series.title}相册封面`} loading="lazy" variant="cover" />
                  <span className="cover-action"><ArrowUpRight size={20} strokeWidth={1.5} /></span>
                </span>
                <span className="collection-meta">
                  <span className="collection-number">{String(WEDDING_COLLECTIONS.indexOf(series) + 1).padStart(2, '0')}</span>
                  <span className="collection-heading"><span className="collection-title">{series.title}</span><span className="collection-subtitle">{series.subtitle}</span></span>
                  <span className="collection-count">{series.photos.length} 张</span>
                </span>
              </button>
            </article>
          ))}
        </section>
        {UNAVAILABLE_COUNT > 0 && <p className="collection-disclaimer"><Image size={14} strokeWidth={1.5} /> 部分影像暂不可用，原有文字记录仍在。</p>}
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
        <div><p className="section-kicker">{selectedSeries.subtitle}</p><h1 id="series-title">{selectedSeries.title}</h1></div>
        <div className="series-intro-note">{selectedSeries.description && <p className="series-description">{selectedSeries.description}</p>}<span className="series-reading-hint"><MoveUpRight size={14} /> 轻点影像，走近一点</span>{selectedSeries.photos.some((photo) => !photo.available) && <p className="series-notice">部分图片暂不可用，仍可查看原有文字记录。</p>}</div>
      </section>

      <section className="series-photos" aria-label={`${selectedSeries.title}影像`}>
        {selectedSeries.photos.map((photo, index) => (
          <button className="series-photo" key={photo.id} onClick={() => setSelectedPhotoIndex(index)} aria-label={`查看${photo.title}${photo.available ? '大图' : '的文字记录，图片暂不可用'}`}>
            <span className="series-photo-image">
              <OriginalImage src={photo.url} alt={photo.alt} available={photo.available} width={photo.width} height={photo.height} loading="lazy" />
              <span className="photo-view-hint"><ArrowUpRight size={18} /> {photo.available ? '查看大图' : '查看记录'}</span>
            </span>
            <span className="series-photo-caption"><span className="photo-number">{String(index + 1).padStart(2, '0')}</span><span className="series-photo-title">{photo.title}</span></span>
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

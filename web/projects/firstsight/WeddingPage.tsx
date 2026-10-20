// Adapted from AndersonHJB/FirstSight pages/WeddingPage.tsx.
// Retains collection → series detail → immersive image navigation.
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Flower2, Heart, Image } from 'lucide-react';
import { WEDDING_COLLECTIONS } from './data';
import { ImmersiveLightbox } from './ImmersiveLightbox';

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
            <span className="section-kicker"><Heart size={16} strokeWidth={1.5} /> WEDDING INSPIRATION</span>
            <h1 id="collection-title">把爱写成一册光影</h1>
          </div>
          <div className="intro-note">
            <p>从花园到海岸，收藏关于光线、色彩与相伴的想象。</p>
            <span className="ai-label">AI 生成示例 · 非真实客片</span>
          </div>
        </section>

        <section className="collections-grid" aria-label="婚纱灵感系列">
          {WEDDING_COLLECTIONS.map((series, index) => (
            <article className="collection" key={series.id}>
              <button className="collection-open" onClick={() => { window.location.hash = `/album/${series.id}`; }} aria-label={`浏览${series.title}系列，${series.photos.length} 幅 AI 灵感影像`}>
                <span className="book-cover">
                  <img src={series.cover} alt={`${series.title}，AI 生成的婚纱灵感示例，非真实客片`} width={1086} height={1448} loading={index === 0 ? 'eager' : 'lazy'} />
                  <span className="cover-label">AI 生成</span>
                  <span className="cover-action">翻开这册影集 <ArrowUpRight size={17} /></span>
                </span>
                <span className="collection-meta">
                  <span className="collection-subtitle">{series.subtitle}</span>
                  <span className="collection-title">{series.title}</span>
                  <span className="collection-count"><Image size={13} /> {series.photos.length} 幅灵感影像</span>
                </span>
              </button>
            </article>
          ))}
        </section>
        <p className="collection-disclaimer">图册中的人物与场景均为 AI 生成，仅供婚纱造型与影像氛围参考。</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="series-page" tabIndex={-1}>
      <nav className="series-nav" aria-label="相册导航">
        <button className="text-button" onClick={() => { window.location.hash = '/'; }}><ArrowLeft size={18} /> 返回全部系列</button>
        <span className="series-nav-title">{selectedSeries.title}</span>
        <span className="ai-label">AI 灵感示例</span>
      </nav>

      <section className="series-intro" aria-labelledby="series-title">
        <Flower2 className="series-flower" size={34} strokeWidth={1} aria-hidden="true" />
        <p className="section-kicker">{selectedSeries.subtitle}</p>
        <h1 id="series-title">{selectedSeries.title}</h1>
        <p className="series-description">{selectedSeries.description}</p>
        <span className="ai-label">AI 生成 · 非真实客片</span>
      </section>

      <section className="series-photos" aria-label={`${selectedSeries.title}影像`}>
        {selectedSeries.photos.map((photo, index) => (
          <button className="series-photo" key={photo.id} onClick={() => setSelectedPhotoIndex(index)} aria-label={`放大查看${photo.title}，AI 生成示例`}>
            <img src={photo.url} alt={photo.alt} width={photo.width} height={photo.height} loading="lazy" />
            <span className="photo-view-hint"><Image size={16} /> 点击查看大图</span>
          </button>
        ))}
      </section>
      <p className="series-end">让灵感停留，让故事慢慢发生。</p>

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

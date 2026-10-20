
import { AlbumType, Photo, WeddingSeries } from '../types';

// Helper to create mock wedding photos
const createWeddingPhotos = (count: number, prefix: string, tag: string): Photo[] => {
  const images = [
     'https://images.unsplash.com/photo-1519741497674-611481863552?q=80&w=1200',
     'https://images.unsplash.com/photo-1511285560982-1356c11d4606?q=80&w=1200',
     'https://images.unsplash.com/photo-1606800052052-a08af7148866?q=80&w=1200',
     'https://images.unsplash.com/photo-1515934751635-c81c6bc9a2d8?q=80&w=1200',
     'https://images.unsplash.com/photo-1520854221250-8c12521743d2?q=80&w=1200',
     'https://images.unsplash.com/photo-1469334031218-e382a71b716b?q=80&w=1200'
  ];

  return Array.from({ length: count }).map((_, i) => ({
    id: `w-${prefix}-${i}`,
    url: [images[i % images.length]],
    title: `${tag} Series ${i + 1}`,
    date: '2023.05.20',
    description: 'Love is not about how many days, months, or years you have been together. It is about how much you love each other every single day.',
    tags: [tag, 'Wedding'],
    albumType: AlbumType.WEDDING,
    width: 800,
    height: 1000,
    exif: { device: 'Sony A7R4', params: '50mm f1.2' }
  }));
};

export const WEDDING_COLLECTIONS: WeddingSeries[] = [
  {
    id: 'ws1',
    title: 'The White Vows',
    subtitle: '纯白誓言 · 室内主纱',
    cover: 'https://images.unsplash.com/photo-1519741497674-611481863552?q=80&w=1200',
    date: '2023.05.20',
    photographer: 'Art Studio',
    description: '极简的背景，突显最纯粹的情感。白纱落地，此刻即是永恒。',
    photos: [
       // Added a video entry here for demonstration
       {
        id: 'ws1-video',
        url: ['https://github.com/AndersonHJB/AndersonHJB.github.io/releases/download/V0.0.4/03-why-code.mp4'],
        mediaType: 'video',
        poster: 'https://images.unsplash.com/photo-1519741497674-611481863552?q=80&w=1200',
        title: 'Wedding Highlights',
        date: '2023.05.20',
        description: '记录下这最美好的一天，誓言、泪水与欢笑。',
        tags: ['Highlight', 'Video'],
        albumType: AlbumType.WEDDING,
        width: 1280,
        height: 720
       },
       ...createWeddingPhotos(6, 'main', 'Classic')
    ],
  },
  {
    id: 'ws2',
    title: 'Vintage Romance',
    subtitle: '复古胶片 · 城市漫步',
    cover: 'https://images.unsplash.com/photo-1511285560982-1356c11d4606?q=80&w=1200',
    date: '2023.05.21',
    photographer: 'Film Lab',
    description: '漫步在老城区的街道，胶片的颗粒感记录下像电影一样的瞬间。',
    photos: createWeddingPhotos(8, 'retro', 'Vintage'),
  },
  {
    id: 'ws3',
    title: 'Forest & Light',
    subtitle: '森系光影 · 自然礼赞',
    cover: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?q=80&w=1200',
    date: '2023.05.22',
    photographer: 'Nature Lens',
    description: '清晨的第一缕阳光穿过树叶，我们在森林里举行了一场只有风知道的婚礼。',
    photos: createWeddingPhotos(5, 'forest', 'Forest'),
  },
];

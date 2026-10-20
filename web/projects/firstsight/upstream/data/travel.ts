
import { AlbumType, Photo, TravelTrip } from '../types';

// Helper to create mock photos
const createPhotos = (count: number, prefix: string, location: string, tags: string[]): Photo[] => {
  const images = [
    'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=1200', // Switzerland
    'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=1200', // Kyoto
    'https://images.unsplash.com/photo-1504214208698-ea1916a2195a?q=80&w=1200', // Thailand
    'https://images.unsplash.com/photo-1528181304800-259b08848508?q=80&w=1200', // Thailand 2
    'https://images.unsplash.com/photo-1526481280693-3bfa7568e0f3?q=80&w=1200', // Japan
    'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?q=80&w=1200', // China Wall
    'https://images.unsplash.com/photo-1548013146-72479768bada?q=80&w=1200', // India
  ];

  return Array.from({ length: count }).map((_, i) => ({
    id: `tr-${prefix}-${i}`,
    url: [images[(i + Math.floor(Math.random() * 5)) % images.length]],
    title: `${location} 记忆 ${i + 1}`,
    date: '2023.10.01',
    description: '旅行不仅是看风景，更是看世界，看众生，最后看自己。',
    tags: ['旅行', ...tags],
    albumType: AlbumType.TRAVEL,
    location: location,
    width: 800,
    height: Math.random() > 0.5 ? 1000 : 600, // Varied aspect ratios
    exif: { device: 'Sony A7M4', params: '24-70mm f2.8' }
  }));
};

export const TRAVEL_TRIPS: TravelTrip[] = [
  {
    id: 't1',
    country: '中国',
    place: '云南',
    title: '彩云之南',
    date: '2023.05',
    cover: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?q=80&w=1200', 
    description: '在大理的风花雪月里，时间仿佛静止了。苍山洱海，心之所向。',
    photos: createPhotos(8, 'yunnan', '大理', ['国内', '自然']),
  },
  {
    id: 't2',
    country: '中国',
    place: '北京',
    title: '古都秋韵',
    date: '2023.10',
    cover: 'https://images.unsplash.com/photo-1508804185872-d7badad00f7d?q=80&w=1200',
    description: '一下雪，北京就成了北平。故宫的红墙黄瓦，在秋叶的映衬下格外庄重。',
    photos: createPhotos(5, 'beijing', '故宫', ['国内', '历史']),
  },
  {
    id: 't3',
    country: '日本',
    place: '京都',
    title: '千年古都',
    date: '2024.04',
    cover: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=1200',
    description: '漫步在祇园的石板路上，偶遇艺伎匆匆走过。清水寺的樱花，开得正好。',
    photos: createPhotos(10, 'kyoto', 'Kyoto', ['国外', '樱花']),
  },
  {
    id: 't4',
    country: '日本',
    place: '北海道',
    title: '白色恋人',
    date: '2024.01',
    cover: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?q=80&w=1200',
    description: '在大雪纷飞的小樽运河旁，喝一杯热咖啡。情书里的场景，就在眼前。',
    photos: createPhotos(6, 'hokkaido', 'Otaru', ['国外', '雪景']),
  },
  {
    id: 't5',
    country: '瑞士',
    place: '因特拉肯',
    title: '阿尔卑斯',
    date: '2019.08',
    cover: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=1200',
    description: '童话里的小木屋，连绵的雪山，碧绿的湖水。在这里，呼吸都是甜的。',
    photos: createPhotos(12, 'swiss', 'Interlaken', ['欧洲', '自然']),
  },
  {
    id: 't6',
    country: '泰国',
    place: '清迈',
    title: '小城故事',
    date: '2018.12',
    cover: 'https://images.unsplash.com/photo-1504214208698-ea1916a2195a?q=80&w=1200',
    description: '在这个节奏缓慢的小城，骑着摩托车穿梭在古巷，感受邓丽君生前最爱的地方。',
    photos: createPhotos(7, 'chiangmai', 'Chiang Mai', ['东南亚', '休闲']),
  }
];

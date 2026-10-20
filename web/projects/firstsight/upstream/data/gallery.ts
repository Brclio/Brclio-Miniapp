
import { AlbumType, Photo } from '../types';

const GALLERY_DATA = [
  {
    id: 'gv1',
    url: [
      'https://github.com/AndersonHJB/AndersonHJB.github.io/releases/download/V0.0.4/03-why-code.mp4',
      ],
    mediaType: 'video' as const,
    title: '编码艺术',
    date: '2024-02-15',
    location: '办公室',
    description: '代码不仅是逻辑，也是流动的艺术。',
    tags: ['视频', '创作'],
    poster: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?q=80&w=1200',
    exif: { device: 'Screen Record', params: '1080p' }
  },
  {
    id: 'g1',
    url: ['https://images.unsplash.com/photo-1491557345352-5929e343eb89?q=80&w=1200'], 
    title: '雪落在丘陵上像蛋糕一样',
    date: '2025-02-08',
    location: '辽宁省凤城市',
    description: '在回家的路上拍的，冬日的阳光洒在积雪覆盖的山丘上，质感像极了刚抹好的奶油蛋糕。',
    tags: ['旅行日记'],
    exif: { device: 'iPhone 13 Pro', params: '26mm f1.5' }
  },
  {
    id: 'g2',
    url: ['https://images.unsplash.com/photo-1533552097808-166299d63f45?q=80&w=1200'], 
    title: '坐黄包车',
    date: '2024-11-15',
    location: '天津五大道',
    description: '老师傅讲起过去的故事眉飞色舞，车轮滚过落叶的声音，是秋天最独特的配乐。',
    tags: ['生活点滴'],
    exif: { device: 'Canon EOS R6', params: '35mm f1.8' }
  },
  {
    id: 'g3',
    url: ['https://images.unsplash.com/photo-1616036740257-9449ea1f6605?q=80&w=1200'],
    title: '火烧云',
    date: '2024-08-30',
    location: '北环路立交桥',
    description: '下班路上偶遇的一场壮丽晚霞，整个城市都被笼罩在橘红色的温柔里。',
    tags: ['生活点滴'],
    exif: { device: 'iPhone 15', params: '24mm f1.6' }
  },
  {
    id: 'g4',
    url: ['https://images.unsplash.com/photo-1508804185872-d7badad00f7d?q=80&w=1200'],
    title: '第一次爬长城',
    date: '2024-01-02',
    location: '北京八达岭',
    description: '不到长城非好汉。冬天的长城苍凉而壮阔，远处的烽火台在雪中若隐若现。',
    tags: ['旅行日记'],
    exif: { device: 'Sony A7M4', params: '16-35mm GM' }
  },
  {
    id: 'g5',
    url: ['https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=1200'],
    title: '库迪送的环保杯',
    date: '2025-01-15',
    location: '办公室',
    description: '新的一年，从一杯环保咖啡开始。这个小杯子意外的好用。',
    tags: ['旅行日记'], 
    exif: { device: 'iPhone 13 Pro', params: '26mm f1.5' }
  },
  {
    id: 'g6',
    url: ['https://images.unsplash.com/photo-1523050854058-8df90110c9f1?q=80&w=1200'],
    title: '曾经辉煌的校园也落寞了',
    date: '2024-05-20',
    location: '丹东一中',
    description: '故地重游，教学楼还是那个教学楼，只是读书的人换了一茬又一茬。',
    tags: ['旅行日记'],
    exif: { device: 'iPhone 13 Pro', params: '77mm f2.8' }
  },
  {
    id: 'g7',
    url: ['https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?q=80&w=1200'],
    title: '上次那个公司的小家伙自己跑丢了',
    date: '2024-06-10',
    location: '园区草坪',
    description: '来了只新的，看起来呆呆的，但眼神里充满了对世界的好奇。',
    tags: ['生活点滴'],
    exif: { device: 'iPhone 13 Pro', params: '26mm f1.5' }
  },
  {
    id: 'g8',
    url: ['https://images.unsplash.com/photo-1573865526739-10659fec78a5?q=80&w=1200'],
    title: '公司来了个新的小家伙',
    date: '2024-06-12',
    location: '会议室',
    description: '它特别喜欢趴在键盘上，可能是想帮我写代码吧。',
    tags: ['生活点滴'],
    exif: { device: 'iPhone 13 Pro', params: '26mm f1.5' }
  }
];

export const GALLERY_PHOTOS: Photo[] = GALLERY_DATA.map(d => ({ ...d, albumType: AlbumType.GALLERY }));

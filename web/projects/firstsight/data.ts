import type { WeddingSeries } from './types';

// Curated public examples only. No upstream personal or family data is imported.
export const WEDDING_COLLECTIONS: WeddingSeries[] = [
  {
    id: 'garden',
    title: '花间来信',
    subtitle: 'GARDEN · 花园婚纱',
    cover: './media/garden.jpg',
    description: '让白纱融进花园的晨光。石径、绿意和柔软的裙摆，为一封关于爱的来信留白。',
    photos: [{
      id: 'garden-01',
      url: './media/garden.jpg',
      width: 1086,
      height: 1448,
      title: '花间来信',
      description: '花园主题婚纱灵感影像。人物与场景由 AI 生成，仅供构图、色彩和氛围参考，非真实客片。',
      alt: '花园石径上的虚构成年新人与婚纱造型，AI 生成的灵感示例，非真实客片',
      tags: ['花园', '自然光', 'AI 生成'],
    }],
  },
  {
    id: 'coast',
    title: '与海相拥',
    subtitle: 'COAST · 海岸婚纱',
    cover: './media/coast.jpg',
    description: '把海风和晚霞收进影集。沿着安静的海岸慢慢走，让相伴成为画面的中心。',
    photos: [{
      id: 'coast-01',
      url: './media/coast.jpg',
      width: 1086,
      height: 1448,
      title: '与海相拥',
      description: '海岸主题婚纱灵感影像。人物与场景由 AI 生成，仅供构图、色彩和氛围参考，非真实客片。',
      alt: '晚霞海岸边的虚构成年新人与婚纱造型，AI 生成的灵感示例，非真实客片',
      tags: ['海岸', '暮色', 'AI 生成'],
    }],
  },
];


import { AlbumType, Photo } from '../types';

// ==========================================
// 棠棠 (Child 1 - Boy)
// ==========================================
const BABY_DATA_1 = [
  {
    id: 'b1-birth',
    url: [
      'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=1200',
      'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=1200',
      'https://images.unsplash.com/photo-1519689680058-324335c77eba?q=80&w=1200'
      ],
    title: '第一张合影',
    date: '2022.05.20',
    location: '产科病房',
    description: '皱巴巴的小脸，却拥有这个世界上最响亮的哭声。',
    tags: ['出生', '第一眼'],
  },
  {
    id: 'b1-step-1',
    url: ['https://images.unsplash.com/photo-1555252333-9f8e92e65df9?q=80&w=1200'],
    title: '蹒跚学步',
    date: '2023.06.10',
    location: '客厅',
    description: '摇摇晃晃走了三步，那是他探索世界的第一大步。',
    tags: ['学步', '里程碑'],
  },
  {
    id: 'b1-school',
    url: ['https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?q=80&w=1200'],
    title: '幼儿园入园',
    date: '2025.09.01',
    location: '育才幼儿园',
    description: '背着小书包，头也不回地走进了校门，爸爸在门口偷偷抹眼泪。',
    tags: ['成长', '入托'],
  }
];

// ==========================================
// 小悦 (Child 2 - Girl)
// ==========================================
const BABY_DATA_2 = [
  {
    id: 'b2-born',
    url: ['https://images.unsplash.com/photo-1523293836414-f04e712e1f3b?q=80&w=1200'],
    title: '小悦来到家',
    date: '2024.06.15',
    location: '市中心医院',
    description: '比哥哥出生时要安静得多，是个文静的小姑娘。',
    tags: ['新生', '妹妹'],
  },
  {
    id: 'b2-hundred-1',
    url: ['https://images.unsplash.com/photo-1510154221590-ff63e90a136f?q=80&w=1200'],
    title: '百日照 A',
    date: '2024.09.20',
    location: '影楼',
    description: '戴上兔耳朵，你就是家里最可爱的小兔子。',
    tags: ['百天', '摄影'],
  },
  {
    id: 'b2-hundred-2',
    url: ['https://images.unsplash.com/photo-1516627145497-ae6968895b74?q=80&w=1200'],
    title: '百日照 B',
    date: '2024.09.20',
    location: '影楼',
    description: '虽然拍摄很累，但你一直努力对着镜头笑。',
    tags: ['百天', '摄影'],
  },
  {
    id: 'b2-video-1',
    url: ['https://github.com/AndersonHJB/AndersonHJB.github.io/releases/download/V0.0.4/03-why-code.mp4'],
    mediaType: 'video' as const,
    poster: 'https://images.unsplash.com/photo-1519741497674-611481863552?q=80&w=1200',
    title: '第一次翻身',
    date: '2024.10.12',
    location: '卧室',
    description: '费了好大的劲，终于成功翻过去了！',
    tags: ['视频', '动作'],
  }
];

// ==========================================
// 棠棠 (Child 3 - Boy - New Demo)
// ==========================================
const BABY_DATA_3 = [
  {
    id: 'b3-born',
    url: ['https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?q=80&w=1200'],
    title: '三宝报道',
    date: '2025.01.10',
    location: '家里',
    description: '全家人的掌中宝，哥哥姐姐们都抢着要抱你。',
    tags: ['三胎', '新生'],
  }
];

export const BABY_PHOTOS_1: Photo[] = BABY_DATA_1.map(d => ({ ...d, albumType: AlbumType.BABY, width: 800, height: 600 }));
export const BABY_PHOTOS_2: Photo[] = BABY_DATA_2.map(d => ({ ...d, albumType: AlbumType.BABY, width: 800, height: 600 }));
export const BABY_PHOTOS_3: Photo[] = BABY_DATA_3.map(d => ({ ...d, albumType: AlbumType.BABY, width: 800, height: 600 }));

export const BABY_PHOTOS: Photo[] = [...BABY_PHOTOS_1, ...BABY_PHOTOS_2, ...BABY_PHOTOS_3];

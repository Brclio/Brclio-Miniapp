export type Word = {
  id: string;
  word: string;
  pos: string;
  meaning: string;
  phonetic: string;
  example: string;
  exampleZh: string;
  definition?: string;
  stageId?: string;
  tags?: string[];
  rank?: number;
};

export type Level = {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  words: Word[];
  memorySeconds: number;
};

export const LEVELS: Level[] = [
  {
    id: 1,
    title: '词汇花园',
    subtitle: 'A little seed, a new beginning.',
    description: '从一片叶子开始，种下你的第一组单词。',
    icon: 'Sprout',
    memorySeconds: 45,
    words: [
      { id: 'apple', word: 'apple', pos: 'n.', meaning: '苹果', phonetic: '/ˈæp.əl/', example: 'She picked a red apple from the tree.', exampleZh: '她从树上摘了一个红苹果。' },
      { id: 'leaf', word: 'leaf', pos: 'n.', meaning: '叶子', phonetic: '/liːf/', example: 'A yellow leaf fell onto my book.', exampleZh: '一片黄叶落在了我的书上。' },
      { id: 'water', word: 'water', pos: 'n.', meaning: '水', phonetic: '/ˈwɔː.tə/', example: 'The flowers need a little water.', exampleZh: '这些花需要一点水。' },
      { id: 'grow', word: 'grow', pos: 'v.', meaning: '生长', phonetic: '/ɡrəʊ/', example: 'These plants grow well in the sun.', exampleZh: '这些植物在阳光下长得很好。' },
      { id: 'fresh', word: 'fresh', pos: 'adj.', meaning: '新鲜的', phonetic: '/freʃ/', example: 'We bought fresh fruit this morning.', exampleZh: '我们今天早上买了新鲜水果。' },
      { id: 'slowly', word: 'slowly', pos: 'adv.', meaning: '缓慢地', phonetic: '/ˈsləʊ.li/', example: 'The little snail moved slowly across the path.', exampleZh: '小蜗牛缓慢地爬过小路。' },
    ],
  },
  {
    id: 2,
    title: '日常小事',
    subtitle: 'Find the lovely in the everyday.',
    description: '把早餐、习惯与小小的分享，装进日常词袋。',
    icon: 'Coffee',
    memorySeconds: 60,
    words: [
      { id: 'morning', word: 'morning', pos: 'n.', meaning: '早晨', phonetic: '/ˈmɔː.nɪŋ/', example: 'I go for a short walk every morning.', exampleZh: '我每天早晨都会散一小会儿步。' },
      { id: 'habit', word: 'habit', pos: 'n.', meaning: '习惯', phonetic: '/ˈhæb.ɪt/', example: 'Reading before bed is a good habit.', exampleZh: '睡前阅读是一个好习惯。' },
      { id: 'prepare', word: 'prepare', pos: 'v.', meaning: '准备', phonetic: '/prɪˈpeə/', example: 'Let us prepare lunch together.', exampleZh: '我们一起准备午饭吧。' },
      { id: 'share', word: 'share', pos: 'v.', meaning: '分享', phonetic: '/ʃeə/', example: 'I want to share this story with you.', exampleZh: '我想和你分享这个故事。' },
      { id: 'tidy', word: 'tidy', pos: 'adj.', meaning: '整洁的', phonetic: '/ˈtaɪ.di/', example: 'Her small kitchen is always tidy.', exampleZh: '她的小厨房总是很整洁。' },
      { id: 'simple', word: 'simple', pos: 'adj.', meaning: '简单的', phonetic: '/ˈsɪm.pəl/', example: 'This soup is simple to make.', exampleZh: '这道汤做起来很简单。' },
      { id: 'often', word: 'often', pos: 'adv.', meaning: '经常', phonetic: '/ˈɒf.ən/', example: 'We often cook at home on Sundays.', exampleZh: '我们星期天经常在家做饭。' },
      { id: 'together', word: 'together', pos: 'adv.', meaning: '一起', phonetic: '/təˈɡeð.ə/', example: 'The whole family had dinner together.', exampleZh: '全家人一起吃了晚饭。' },
    ],
  },
  {
    id: 3,
    title: '城市漫游',
    subtitle: 'Every corner has a story.',
    description: '沿街走走，让单词带你找到城市里的新风景。',
    icon: 'Building2',
    memorySeconds: 65,
    words: [
      { id: 'corner', word: 'corner', pos: 'n.', meaning: '拐角', phonetic: '/ˈkɔː.nə/', example: 'There is a bookshop on the corner.', exampleZh: '拐角处有一家书店。' },
      { id: 'station', word: 'station', pos: 'n.', meaning: '车站', phonetic: '/ˈsteɪ.ʃən/', example: 'Meet me outside the train station.', exampleZh: '在火车站外面和我见面吧。' },
      { id: 'bridge', word: 'bridge', pos: 'n.', meaning: '桥梁', phonetic: '/brɪdʒ/', example: 'We crossed the bridge before sunset.', exampleZh: '我们在日落前过了桥。' },
      { id: 'explore', word: 'explore', pos: 'v.', meaning: '探索', phonetic: '/ɪkˈsplɔː/', example: 'We spent the afternoon exploring the old town.', exampleZh: '我们花了一下午探索这座老城。' },
      { id: 'follow', word: 'follow', pos: 'v.', meaning: '跟随', phonetic: '/ˈfɒl.əʊ/', example: 'Follow me to the new café.', exampleZh: '跟我去那家新咖啡馆吧。' },
      { id: 'crowded', word: 'crowded', pos: 'adj.', meaning: '拥挤的', phonetic: '/ˈkraʊ.dɪd/', example: 'The bus was crowded this evening.', exampleZh: '今天傍晚公交车上很拥挤。' },
      { id: 'nearby', word: 'nearby', pos: 'adv.', meaning: '在附近', phonetic: '/ˌnɪəˈbaɪ/', example: 'My best friend lives nearby.', exampleZh: '我最好的朋友住在附近。' },
      { id: 'straight', word: 'straight', pos: 'adv.', meaning: '径直', phonetic: '/streɪt/', example: 'Go straight along this street.', exampleZh: '沿着这条街一直往前走。' },
    ],
  },
  {
    id: 4,
    title: '心情调色盘',
    subtitle: 'Give your feelings a little color.',
    description: '为喜悦、勇气和好奇心，找到恰好的英语表达。',
    icon: 'Heart',
    memorySeconds: 75,
    words: [
      { id: 'joy', word: 'joy', pos: 'n.', meaning: '喜悦', phonetic: '/dʒɔɪ/', example: 'Her face was full of joy.', exampleZh: '她的脸上洋溢着喜悦。' },
      { id: 'courage', word: 'courage', pos: 'n.', meaning: '勇气', phonetic: '/ˈkʌr.ɪdʒ/', example: 'It takes courage to try something new.', exampleZh: '尝试新事物需要勇气。' },
      { id: 'trust', word: 'trust', pos: 'v.', meaning: '信任', phonetic: '/trʌst/', example: 'I trust you to make a good choice.', exampleZh: '我相信你会做出好的选择。' },
      { id: 'worry', word: 'worry', pos: 'v.', meaning: '担心', phonetic: '/ˈwʌr.i/', example: 'Do not worry about small mistakes.', exampleZh: '别为小错误担心。' },
      { id: 'proud', word: 'proud', pos: 'adj.', meaning: '自豪的', phonetic: '/praʊd/', example: 'I am proud of the progress you have made.', exampleZh: '我为你取得的进步感到自豪。' },
      { id: 'calm', word: 'calm', pos: 'adj.', meaning: '平静的', phonetic: '/kɑːm/', example: 'She stayed calm during the interview.', exampleZh: '她在面试时保持了平静。' },
      { id: 'curious', word: 'curious', pos: 'adj.', meaning: '好奇的', phonetic: '/ˈkjʊə.ri.əs/', example: 'The child is curious about the stars.', exampleZh: '这个孩子对星星充满好奇。' },
      { id: 'grateful', word: 'grateful', pos: 'adj.', meaning: '感激的', phonetic: '/ˈɡreɪt.fəl/', example: 'I am grateful for your help.', exampleZh: '我很感激你的帮助。' },
      { id: 'gently', word: 'gently', pos: 'adv.', meaning: '温柔地', phonetic: '/ˈdʒent.li/', example: 'She spoke gently to the frightened child.', exampleZh: '她温柔地对那个受惊的孩子说话。' },
      { id: 'suddenly', word: 'suddenly', pos: 'adv.', meaning: '突然', phonetic: '/ˈsʌd.ən.li/', example: 'He suddenly started to laugh.', exampleZh: '他突然笑了起来。' },
    ],
  },
  {
    id: 5,
    title: '灵感工作室',
    subtitle: 'Small ideas, wonderful possibilities.',
    description: '从一个想法到一幅草图，把灵感变成新的收获。',
    icon: 'Lightbulb',
    memorySeconds: 80,
    words: [
      { id: 'idea', word: 'idea', pos: 'n.', meaning: '想法', phonetic: '/aɪˈdɪə/', example: 'That is a wonderful idea for a story.', exampleZh: '那是一个很棒的故事构思。' },
      { id: 'sketch', word: 'sketch', pos: 'n.', meaning: '草图', phonetic: '/sketʃ/', example: 'She made a quick sketch of the room.', exampleZh: '她快速画了一张房间的草图。' },
      { id: 'focus', word: 'focus', pos: 'v.', meaning: '专注', phonetic: '/ˈfəʊ.kəs/', example: 'Try to focus on one task at a time.', exampleZh: '试着一次只专注于一项任务。' },
      { id: 'create', word: 'create', pos: 'v.', meaning: '创造', phonetic: '/kriˈeɪt/', example: 'You can create a new world with words.', exampleZh: '你可以用文字创造一个新世界。' },
      { id: 'improve', word: 'improve', pos: 'v.', meaning: '改善', phonetic: '/ɪmˈpruːv/', example: 'A little practice can improve your drawing.', exampleZh: '稍加练习就能改善你的绘画水平。' },
      { id: 'patient', word: 'patient', pos: 'adj.', meaning: '有耐心的', phonetic: '/ˈpeɪ.ʃənt/', example: 'Be patient when you learn a new skill.', exampleZh: '学习新技能时要有耐心。' },
      { id: 'useful', word: 'useful', pos: 'adj.', meaning: '有用的', phonetic: '/ˈjuːs.fəl/', example: 'This notebook is useful for collecting ideas.', exampleZh: '这个笔记本很适合用来收集想法。' },
      { id: 'unique', word: 'unique', pos: 'adj.', meaning: '独特的', phonetic: '/juːˈniːk/', example: 'Every artist has a unique style.', exampleZh: '每位艺术家都有独特的风格。' },
      { id: 'clearly', word: 'clearly', pos: 'adv.', meaning: '清楚地', phonetic: '/ˈklɪə.li/', example: 'Please explain your idea clearly.', exampleZh: '请清楚地说明你的想法。' },
      { id: 'carefully', word: 'carefully', pos: 'adv.', meaning: '仔细地', phonetic: '/ˈkeə.fəl.i/', example: 'Read the instructions carefully before you begin.', exampleZh: '开始之前请仔细阅读说明。' },
    ],
  },
  {
    id: 6,
    title: '探索远方',
    subtitle: 'A whole world of words awaits.',
    description: '带上一路积累的单词，出发去看看更大的世界。',
    icon: 'Compass',
    memorySeconds: 90,
    words: [
      { id: 'journey', word: 'journey', pos: 'n.', meaning: '旅程', phonetic: '/ˈdʒɜː.ni/', example: 'Our journey began on a rainy morning.', exampleZh: '我们的旅程从一个雨天的早晨开始。' },
      { id: 'island', word: 'island', pos: 'n.', meaning: '岛屿', phonetic: '/ˈaɪ.lənd/', example: 'We took a boat to a small island.', exampleZh: '我们乘船去了一座小岛。' },
      { id: 'horizon', word: 'horizon', pos: 'n.', meaning: '地平线', phonetic: '/həˈraɪ.zən/', example: 'The sun disappeared below the horizon.', exampleZh: '太阳消失在了地平线下。' },
      { id: 'discover', word: 'discover', pos: 'v.', meaning: '发现', phonetic: '/dɪˈskʌv.ə/', example: 'We discovered a quiet beach near the village.', exampleZh: '我们在村子附近发现了一片安静的海滩。' },
      { id: 'protect', word: 'protect', pos: 'v.', meaning: '保护', phonetic: '/prəˈtekt/', example: 'We must protect the animals that live here.', exampleZh: '我们必须保护生活在这里的动物。' },
      { id: 'wonder', word: 'wonder', pos: 'v.', meaning: '想知道', phonetic: '/ˈwʌn.də/', example: 'I wonder what lies beyond those mountains.', exampleZh: '我想知道那些山的另一边有什么。' },
      { id: 'distant', word: 'distant', pos: 'adj.', meaning: '遥远的', phonetic: '/ˈdɪs.tənt/', example: 'We could see a distant mountain through the clouds.', exampleZh: '透过云层，我们能看到远处的一座山。' },
      { id: 'brave', word: 'brave', pos: 'adj.', meaning: '勇敢的', phonetic: '/breɪv/', example: 'The brave explorer entered the dark cave.', exampleZh: '勇敢的探险者走进了黑暗的洞穴。' },
      { id: 'peaceful', word: 'peaceful', pos: 'adj.', meaning: '宁静的', phonetic: '/ˈpiːs.fəl/', example: 'The lake is peaceful in the early morning.', exampleZh: '清晨的湖面十分宁静。' },
      { id: 'finally', word: 'finally', pos: 'adv.', meaning: '最后', phonetic: '/ˈfaɪ.nəl.i/', example: 'After a long walk, we finally reached the top.', exampleZh: '走了很久之后，我们终于到达了山顶。' },
      { id: 'abroad', word: 'abroad', pos: 'adv.', meaning: '在国外', phonetic: '/əˈbrɔːd/', example: 'My sister is studying abroad this year.', exampleZh: '我姐姐今年在国外留学。' },
      { id: 'forward', word: 'forward', pos: 'adv.', meaning: '向前', phonetic: '/ˈfɔː.wəd/', example: 'Take one small step forward.', exampleZh: '向前迈出一小步。' },
    ],
  },
];

import { useState, useEffect, useRef } from 'react';
import { Hand, RotateCcw, Play, AlertTriangle, Trophy, Volume2, VolumeX, Mic, MicOff, Activity, RefreshCw, BarChart3, Loader2, Music, Zap, Gift, Lock, Sparkles, Dices, Eye, EyeOff, KeyRound, Infinity, XCircle, LogOut, FileImage, Download, Trash2, Save, Settings, Clock, Upload } from 'lucide-react';

// --- 类型定义 ---
type GameState = 'IDLE' | 'WAITING' | 'GO' | 'ENDED';
type Player = 'p1' | 'p2' | null;
type WinReason = 'REACTION' | 'FALSE_START' | 'VOICE_TRIGGER' | null;
type GameMode = 'TOUCH' | 'VOICE' | 'INFINITE'; 
type RewardCategory = 'ALL' | 'FOOD' | 'CHORES' | 'PRANK' | 'LOVE' | 'MONEY' | 'CUSTOM';

interface GameLog {
    step: 'WAITING' | 'GO' | 'END';
    timestamp: number;
    winner?: Player;
    winReason?: WinReason;
    reactionTime?: number;
    audioBlob?: Blob;
    detectedPitch?: number;
    blobSize?: number;
    recordingStartTime?: number; 
    triggerTimestamp?: number; 
    signalTimestamp?: number; 
}

// 无限模式单局记录
interface InfiniteRoundRecord {
    roundNumber: number;
    winner: Player;
    reward: string;
    timestamp: number;
}

// --- 常量：分类彩头库 ---
const REWARD_POOLS: Record<Exclude<RewardCategory, 'CUSTOM'>, string[]> = {
    ALL: [], // 运行时自动合并
    FOOD: [
        "请喝超大杯奶茶", "请吃一顿海底捞", "负责买一周早饭", "请吃肯德基疯狂星期四", "请吃豪华冰淇淋", 
        "负责剥一盘小龙虾", "请吃便利店随便挑", "请喝星巴克", "做一顿丰盛晚餐", "请吃路边摊烧烤",
        "请吃米其林一星", "买一箱快乐水", "请吃麻辣烫(加两份肉)", "负责洗一周水果", "请吃哈根达斯",
        "买对方最爱吃的零食", "请吃深夜食堂", "承包一周的夜宵", "请吃自助餐", "买一个大西瓜",
        "请吃烤全羊", "请吃日式放题", "请吃泰式火锅", "请吃广式早茶", "请吃北京烤鸭",
        "请吃重庆小面", "请吃螺蛳粉(加炸蛋)", "请吃过桥米线", "请吃兰州拉面(加肉)", "请吃沙县小吃(全套)",
        "负责切好一盘水果", "做一份爱心便当", "请吃甜甜圈", "请吃提拉米苏", "请吃舒芙蕾",
        "请喝手冲咖啡", "请喝鲜榨果汁", "请喝精酿啤酒", "请吃韩式炸鸡", "请吃章鱼小丸子",
        "请吃关东煮", "请吃钵钵鸡", "请吃铁板烧", "请吃寿喜烧", "请吃冬阴功汤",
        "请吃海南鸡饭", "请吃肉骨茶", "请吃菠萝包", "请吃双皮奶", "请吃杨枝甘露",
        "请吃榴莲千层", "请吃脏脏包", "请吃马卡龙", "请吃铜锣烧", "请吃鲷鱼烧",
        "请吃大阪烧", "请吃文字烧", "请吃天妇罗", "请吃鳗鱼饭", "请吃三文鱼刺身",
        "请吃波士顿龙虾", "请吃帝王蟹", "请吃佛跳墙", "请吃开水白菜", "请吃文思豆腐",
        "请吃叫花鸡", "请吃东坡肉", "请吃红烧狮子头", "请吃松鼠桂鱼", "请吃龙井虾仁",
        "请吃大煮干丝", "请吃三套鸭", "请吃水晶肴肉", "请吃软兜长鱼", "请吃平桥豆腐",
        "请吃蟹粉狮子头", "请吃拆烩鲢鱼头", "请吃扒烧整猪头", "请吃清炖蟹粉狮子头", "请吃清炖鸡孚",
        "请吃金陵盐水鸭", "请吃老鸭汤", "请吃鸭血粉丝汤", "请吃牛肉锅贴", "请吃桂花糖芋苗",
        "请吃赤豆酒酿小元宵", "请吃梅花糕", "请吃皮肚面", "请吃小笼包", "请吃生煎包"
    ],
    CHORES: [
        "洗一周的碗", "负责倒一周垃圾", "手洗所有袜子", "给对方按摩肩膀20分钟", "负责取一周快递",
        "拖全家的地", "刷全家的鞋", "负责叠一周衣服", "清理猫砂/遛狗一周", "负责剥虾",
        "负责洗全家水果", "给手机贴膜", "负责收拾桌子", "负责洗车一次", "负责晒被子",
        "负责擦玻璃", "负责通下水道", "负责换灯泡", "负责修理家电", "负责买菜",
        "负责做饭", "负责洗碗", "负责擦桌子", "负责扫地", "负责拖地",
        "负责倒垃圾", "负责洗衣服", "负责晾衣服", "负责叠衣服", "负责收纳整理",
        "负责清洁厨房", "负责清洁卫生间", "负责清洁阳台", "负责清洁卧室", "负责清洁客厅",
        "负责给宠物洗澡", "负责给宠物梳毛", "负责给宠物剪指甲", "负责给宠物喂食", "负责给植物浇水",
        "负责给植物施肥", "负责给植物修剪", "负责给植物换盆", "负责清洗空调滤网", "负责清洗洗衣机槽",
        "负责清洗油烟机", "负责清洗冰箱", "负责清洗微波炉", "负责清洗烤箱", "负责清洗饮水机",
        "负责清洗加湿器", "负责清洗空气净化器", "负责清洗吸尘器", "负责清洗扫地机器人", "负责清洗拖地机器人",
        "负责清洗电风扇", "负责清洗取暖器", "负责清洗除湿机", "负责清洗挂烫机", "负责清洗干衣机",
        "负责清洗洗碗机", "负责清洗消毒柜", "负责清洗净水器", "负责清洗垃圾处理器", "负责清洗智能马桶盖",
        "负责清洗浴缸", "负责清洗淋浴房", "负责清洗洗手台", "负责清洗马桶", "负责清洗地漏",
        "负责清洗窗帘", "负责清洗地毯", "负责清洗沙发套", "负责清洗床单被套", "负责清洗枕套",
        "负责清洗毛巾浴巾", "负责清洗抹布", "负责清洗拖把", "负责清洗扫把", "负责清洗垃圾桶"
    ],
    PRANK: [
        "朋友圈发丑照一张(保留24h)", "学猫叫三声", "用屁股写字", "大声喊我是猪", "换个搞笑头像一天",
        "给异性好友发'我想你了'", "模仿大猩猩锤胸口", "跳一段女团舞", "唱一首儿歌", "深情朗读土味情话",
        "用方言说我爱你", "做10个俯卧撑", "模仿尔康表情包", "发一条肉麻朋友圈", "对着镜子猜拳直到赢",
        "给前任发个问号", "在家族群发表情包", "把微信名改成'二狗'", "闻对方袜子", "吃一口生大蒜",
        "喝一杯苦瓜汁", "喝一杯柠檬汁(不加糖)", "喝一杯醋", "吃一勺芥末", "生吃一个辣椒",
        "做20个深蹲", "做30个开合跳", "平板支撑1分钟", "靠墙静蹲1分钟", "单腿站立2分钟",
        "模仿一种动物叫声", "模仿一种乐器声音", "模仿一个明星", "模仿一个动漫角色", "模仿一个表情包",
        "讲一个冷笑话", "讲一个鬼故事", "讲一个尴尬的故事", "讲一个秘密", "讲一个真心话",
        "大冒险：给通讯录第10个人打电话", "大冒险：给通讯录第20个人发短信", "大冒险：给微信第5个人发表情包", "大冒险：给微信第10个人发语音", "大冒险：给最近通话的人回电话",
        "真心话：初吻是什么时候", "真心话：暗恋过谁", "真心话：最丢脸的事", "真心话：最讨厌谁", "真心话：最想去哪里",
        "真心话：最喜欢的颜色", "真心话：最喜欢的食物", "真心话：最喜欢的电影", "真心话：最喜欢的歌", "真心话：最喜欢的书",
        "真心话：最想做的事", "真心话：最遗憾的事", "真心话：最感动的事", "真心话：最开心的事", "真心话：最难过的事",
        "真心话：最害怕的事", "真心话：最讨厌的食物", "真心话：最讨厌的动物", "真心话：最讨厌的人", "真心话：最想见的人"
    ],
    LOVE: [
        "无条件答应一个要求", "深情对视一分钟", "公主抱一分钟", "亲吻额头", "为对方吹头发",
        "给对方写一封情书", "陪对方看一场电影", "陪对方逛街", "清空对方购物车(限额)", "陪对方去想去的地方",
        "给对方洗脚", "背对方走一段路", "给对方剪指甲", "陪对方打游戏", "夸奖对方10分钟",
        "为对方做一顿早餐", "为对方做一顿午餐", "为对方做一顿晚餐", "为对方做一次按摩", "为对方唱一首情歌",
        "为对方画一幅画", "为对方拍一组照片", "为对方剪辑一个视频", "为对方写一首诗", "为对方编一支舞",
        "陪对方看日出", "陪对方看日落", "陪对方看星星", "陪对方看月亮", "陪对方看流星雨",
        "陪对方去游乐园", "陪对方去动物园", "陪对方去植物园", "陪对方去海洋馆", "陪对方去博物馆",
        "陪对方去美术馆", "陪对方去图书馆", "陪对方去书店", "陪对方去咖啡店", "陪对方去甜品店",
        "陪对方去公园", "陪对方去爬山", "陪对方去海边", "陪对方去森林", "陪对方去沙漠",
        "陪对方去草原", "陪对方去雪山", "陪对方去古镇", "陪对方去乡村", "陪对方去城市",
        "陪对方去旅行", "陪对方去露营", "陪对方去野餐", "陪对方去徒步", "陪对方去骑行",
        "陪对方去跑步", "陪对方去游泳", "陪对方去健身", "陪对方去瑜伽", "陪对方去冥想"
    ],
    MONEY: [
        "发 5.20 元红包", "发 13.14 元红包", "发 50 元红包", "发 66 元红包", "发 88 元红包",
        "买一个对方喜欢的皮肤", "报销今晚打车费", "送一张彩票", "买一个盲盒", "承包一个月视频会员",
        "发 100 元红包", "发 200 元红包", "发 520 元红包", "发 1314 元红包", "发 666 元红包",
        "发 888 元红包", "买一只口红", "买一瓶香水", "买一件衣服", "买一双鞋子",
        "买一个包包", "买一块手表", "买一条项链", "买一个手镯", "买一对耳环",
        "买一个戒指", "买一个发夹", "买一个发圈", "买一个帽子", "买一条围巾",
        "买一副手套", "买一双袜子", "买一件睡衣", "买一套内衣", "买一套泳衣",
        "买一件运动服", "买一双运动鞋", "买一个瑜伽垫", "买一个哑铃", "买一个跳绳",
        "买一个篮球", "买一个足球", "买一个排球", "买一个羽毛球拍", "买一个乒乓球拍",
        "买一个网球拍", "买一个高尔夫球杆", "买一个滑板", "买一个轮滑鞋", "买一个自行车",
        "买一个电动车", "买一个摩托车", "买一个汽车", "买一套房子", "买一个岛屿",
        "清空购物车(500以内)", "清空购物车(1000以内)", "清空购物车(2000以内)", "清空购物车(5000以内)", "清空购物车(无限制)"
    ]
};

// 预处理 ALL 集合
REWARD_POOLS.ALL = [
    ...REWARD_POOLS.FOOD, 
    ...REWARD_POOLS.CHORES, 
    ...REWARD_POOLS.PRANK, 
    ...REWARD_POOLS.LOVE, 
    ...REWARD_POOLS.MONEY
];

// 定义默认的回退池（即之前的 RANDOM_REWARDS）
const RANDOM_REWARDS = REWARD_POOLS.ALL;

const CATEGORY_LABELS: Record<string, string> = {
    ALL: "🎲 全部",
    FOOD: "🍔 美食",
    CHORES: "🧹 家务",
    PRANK: "🤡 整蛊",
    LOVE: "❤️ 互动",
    MONEY: "💰 破财",
    CUSTOM: "✨ 自定义"
};

// 100个好玩、好笑、有趣的游戏名称
const RANDOM_TITLES = [
    "洗碗争霸赛", "谁去拿外卖", "今晚谁买单", "家务分配局", "尊严保卫战", "父子局", "母女局", "谁是小狗", "奶茶归属权", "谁去倒垃圾",
    "谁去关灯", "谁去铲屎", "谁去遛狗", "空调遥控权", "电视遥控权", "谁睡沙发", "谁是家中一霸", "谁是家庭帝位", "谁是小趴菜", "谁是欧皇",
    "谁是非酋", "智商检测局", "手速测试", "反应力大赛", "老年人复健", "幼儿园大班", "小学鸡互啄", "菜鸡互啄", "巅峰对决", "紫禁之巅",
    "华山论剑", "决战光明顶", "诸神黄昏", "世纪之战", "地球保卫战", "宇宙第一武道会", "天下第一武道会", "吃鸡决赛圈", "刚枪圣地", "P城乱斗",
    "落地成盒", "谁是卷王", "谁是摸鱼王", "带薪拉扯", "职场生存战", "绩效争夺战", "谁去拿快递", "谁去取外卖", "谁去洗水果", "谁去切西瓜",
    "第一届且唯一一届", "友谊第一比赛第二", "友谊的小船", "翻船现场", "塑料姐妹花", "塑料兄弟情", "恩断义绝", "反目成仇", "相爱相杀", "致命节奏",
    "心跳回忆", "速度与激情", "极速传说", "秋名山车神", "逮虾户", "逮到你了", "你过来啊", "这瓜保熟吗", "年轻人不讲武德", "耗子尾汁",
    "大意了没有闪", "我看不懂", "但我大受震撼", "泰裤辣", "依托答辩", "九转大肠", "科技与狠活", "海克斯科技", "绝绝子", "真香定律",
    "真相只有一个", "凶手就是你", "燃烧吧小宇宙", "奥特曼打小怪兽", "巴啦啦能量", "古娜拉黑暗之神", "代表月亮消灭你", "原神启动", "启动！", "哈士奇拆家",
    "猫猫拳PK", "咸鱼翻身", "躺平大赛", "发疯文学", "废话文学", "阴阳怪气", "顶级拉扯", "秦王绕柱", "反复横跳", "优势在我"
];

// 100个好玩、好笑、有趣的玩家名称
const RANDOM_PLAYER_NAMES = [
    "精神小伙", "鬼火少年", "葬爱冷少", "水晶男孩", "狂拽酷炫", "爷傲奈我何", "往事随风", "寂寞如雪", "快乐星球", "银河系富二代",
    "幼儿园扛把子", "小学组组长", "虽然菜但爱玩", "又菜又爱叫", "峡谷养爹人", "电竞BB机", "祖安文科状元", "钢琴家", "只会喊666", "带妹界耻辱",
    "富婆抱抱我", "阿姨我不想努力了", "保安大队长", "外卖品鉴师", "奶茶鉴赏家", "睡务局局长", "熬夜锦标赛冠军", "退堂鼓一级演员", "赖床专业户", "摸鱼课代表",
    "干饭王", "干饭不积极", "脑子瓦特了", "智慧的眼神", "清澈的愚蠢", "二哈本哈", "拆家小能手", "撒手没", "修勾", "卡皮巴拉",
    "情绪稳定", "吗喽", "私密马赛", "红豆泥", "美羊羊", "沸羊羊", "懒羊羊", "灰太狼", "光头强", "熊大",
    "熊二", "吉吉国王", "猪猪侠", "超级飞侠", "魔仙女王", "游乐王子", "雨女无瓜", "要你寡", "这就去送", "我没K",
    "布鲁biu", "恐龙抗狼", "我姓石", "想你的液", "蓝色妖姬", "黄金切尔西", "红色风暴", "英雄不朽", "我方水晶", "敌方水晶",
    "偷塔小王子", "草丛三婊", "伏地魔", "老六", "我是老六", "不讲武德", "耗子尾汁", "马老师", "练习生", "唱跳RAP",
    "及你太美", "小黑子", "荔枝", "油饼", "香精煎鱼", "食不食油饼", "你干嘛", "哎呦", "梅气罐", "依托答辩",
    "九转大肠", "保留原味", "纯爱战神", "牛头人酋长", "秋名山车神", "落地成盒", "人体描边大师", "在这个年纪睡得着", "还有头发吗", "普通家庭马化腾"
];

const STORAGE_KEY_TITLE = 'RGD_CUSTOM_TITLE';
const STORAGE_KEY_P1_NAME = 'RGD_P1_NAME';
const STORAGE_KEY_P2_NAME = 'RGD_P2_NAME';
const STORAGE_KEY_MAX_WAIT = 'RGD_MAX_WAIT'; 
const STORAGE_KEY_TS = 'RGD_TITLE_TS'; 
const STORAGE_KEY_CUSTOM_REWARDS = 'RGD_CUSTOM_REWARDS'; // 新增：自定义彩头Key
const STORAGE_KEY_CUSTOM_TS = 'RGD_CUSTOM_TS'; // 新增：自定义彩头时间戳

// --- 全局共享音频上下文 (iOS 修复关键) ---
let sharedAudioCtx: AudioContext | null = null;

// --- 自定义 Logo SVG 组件 ---
const CustomLogo = ({ className }: { className?: string }) => (
    <svg 
        className={className} 
        viewBox="0 0 1000 1000" 
        version="1.1" 
        xmlns="http://www.w3.org/2000/svg" 
        style={{ fillRule: 'evenodd', clipRule: 'evenodd', strokeLinejoin: 'round', strokeMiterlimit: 2 }}
    >
        <g transform="matrix(1.4026,0,0,1.4026,-203.526,-204.224)">
            <g transform="matrix(0,-1,-1,0,501.589,155.604)">
                <path d="M-346.482,-346.482C-537.84,-346.482 -692.964,-191.356 -692.964,0C-692.964,191.356 -537.84,346.482 -346.482,346.482C-155.125,346.482 0,191.356 0,0C0,-191.356 -155.125,-346.482 -346.482,-346.482" style={{fill:'rgb(255,248,0)', fillRule:'nonzero'}}/>
            </g>
            <g transform="matrix(1,0,0,1,501.589,838.569)">
                <path d="M0,-672.965C-185.537,-672.965 -336.482,-522.02 -336.482,-336.483C-336.482,-150.945 -185.537,0 0,0C185.537,0 336.482,-150.945 336.482,-336.483C336.482,-522.02 185.537,-672.965 0,-672.965M0,20C-48.121,20 -94.807,10.573 -138.762,-8.019C-181.213,-25.974 -219.335,-51.676 -252.071,-84.411C-284.807,-117.147 -310.509,-155.27 -328.464,-197.72C-347.056,-241.676 -356.482,-288.362 -356.482,-336.483C-356.482,-384.603 -347.056,-431.289 -328.464,-475.245C-310.509,-517.695 -284.807,-555.818 -252.071,-588.554C-219.335,-621.289 -181.213,-646.991 -138.762,-664.947C-94.807,-683.538 -48.121,-692.965 0,-692.965C48.12,-692.965 94.807,-683.538 138.762,-664.947C181.213,-646.991 219.335,-621.289 252.071,-588.554C284.807,-555.818 310.509,-517.695 328.464,-475.245C347.056,-431.289 356.482,-384.603 356.482,-336.483C356.482,-288.362 347.056,-241.676 328.464,-197.72C310.509,-155.27 284.807,-117.147 252.071,-84.411C219.335,-51.676 181.213,-25.974 138.762,-8.019C94.807,10.573 48.12,20 0,20" style={{fillRule:'nonzero'}}/>
            </g>
            <g transform="matrix(1,0,0,1,367.718,410.379)">
                <path d="M0,-36.841L37.819,-36.841L33.188,0.769L-4.623,0.844L0,-36.841ZM-40.716,68.511L-12.924,68.511L-8.008,28.438L29.781,28.438L24.886,68.187L53.001,68.187L57.822,28.438L92.427,28.438L95.659,0.646L61.184,0.714L65.738,-36.841L101.153,-36.841L104.384,-64.633L69.1,-64.564L74.007,-105.029L46.215,-105.029L41.226,-64.509L3.385,-64.434L8.405,-105.352L-19.71,-105.352L-24.661,-64.379L-59.783,-64.31L-63.338,-36.841L-27.988,-36.841L-32.547,0.898L-68.509,0.969L-72.063,28.438L-35.875,28.438L-40.716,68.511Z" style={{fill:'rgb(5,5,5)', fillRule:'nonzero'}}/>
            </g>
            <g transform="matrix(1,0,0,1,711.06,323.151)">
                <path d="M0,154.223L-2.723,119.566L-111.149,85.404L-9.654,35.152L-12.625,0L-143.825,68.571L-140.607,108.179L0,154.223Z" style={{fill:'rgb(5,5,5)', fillRule:'nonzero'}}/>
            </g>
            <g transform="matrix(1,0,0,1,659.86,639.05)">
                <path d="M0,-10.069C-4.68,-0.523 -14.224,5.839 -27.699,5.278C-41.175,4.716 -106.493,-4.08 -124.461,-4.641C-142.429,-5.203 -151.6,12.203 -163.952,25.679C-173.123,2.846 -180.609,-7.823 -192.775,-11.566C-204.94,-15.309 -266.328,-20.549 -283.36,-22.608C-300.392,-24.667 -306.755,-26.351 -312.744,-38.517C-318.733,-50.683 -315.177,-70.521 -315.177,-70.521L-349.24,-74.452C-349.24,-74.452 -351.861,-60.415 -351.486,-38.33C-351.112,-16.245 -348.117,-1.834 -329.775,6.402C-311.434,14.637 -258.092,20.064 -224.965,22.497C-191.837,24.931 -187.533,29.61 -184.351,37.283C-181.169,44.955 -184.675,60.199 -184.675,60.199C-184.675,60.199 -177.436,61.216 -150.292,64.383C-149.274,46.513 -147.351,41.989 -141.131,36.899C-134.911,31.809 -124.505,33.618 -93.063,36.897C-61.62,40.176 -37.417,46.057 -10.159,45.152C17.099,44.246 26.485,27.846 32.479,10.202C38.474,-7.441 39.154,-31.647 39.154,-31.647L5.45,-35.266C5.45,-35.266 4.68,-19.615 0,-10.069" style={{fill:'rgb(5,5,5)', fillRule:'nonzero'}}/>
            </g>
        </g>
    </svg>
);

// --- 简单的 Canvas 礼花组件 ---
const Confetti = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 使用 dvh 高度计算
        const updateSize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        updateSize();
        window.addEventListener('resize', updateSize);

        const particles: any[] = [];
        const colors = ['#FFC700', '#FF0000', '#2E3192', '#41BBC7', '#73FF00', '#FF00EA'];

        for (let i = 0; i < 150; i++) {
            particles.push({
                x: window.innerWidth / 2,
                y: window.innerHeight / 2,
                w: Math.random() * 10 + 5,
                h: Math.random() * 10 + 5,
                vx: (Math.random() - 0.5) * 20,
                vy: (Math.random() - 0.5) * 20,
                color: colors[Math.floor(Math.random() * colors.length)],
                gravity: 0.1 + Math.random() * 0.2,
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 10
            });
        }

        let animationId: number;
        const render = () => {
            if (!canvas || !ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particles.forEach((p, index) => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += p.gravity;
                p.rotation += p.rotationSpeed;
                p.vx *= 0.96; // 阻力
                p.vy *= 0.96;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();

                if (p.y > canvas.height) particles.splice(index, 1);
            });

            if (particles.length > 0) {
                animationId = requestAnimationFrame(render);
            }
        };
        render();

        return () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener('resize', updateSize);
        };
    }, []);

    return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-50" />;
};

// --- 声纹可视化组件 ---
const AudioVisualizer = ({ analyser, color = '#fbbf24' }: { analyser: AnalyserNode | null, color?: string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!analyser || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        let animationId: number;

        const render = () => {
            animationId = requestAnimationFrame(render);
            analyser.getByteFrequencyData(dataArray);

            const width = rect.width;
            const height = rect.height;
            ctx.clearRect(0, 0, width, height);

            const barWidth = 6;
            const gap = 5;
            const barCount = Math.floor(width / (barWidth + gap));
            const step = Math.floor(bufferLength / barCount); 

            const totalWidth = barCount * (barWidth + gap);
            const startX = (width - totalWidth) / 2;

            for (let i = 0; i < barCount; i++) {
                let value = 0;
                for(let j=0; j<step; j++) {
                    value += dataArray[i * step + j];
                }
                value = value / step;

                const percent = value / 255;
                const barHeight = Math.max(6, percent * height * 0.8); 
                
                const x = startX + i * (barWidth + gap);
                const y = (height - barHeight) / 2;

                ctx.fillStyle = color;
                ctx.globalAlpha = 0.4 + percent * 0.6; 
                
                ctx.beginPath();
                ctx.roundRect(x, y, barWidth, barHeight, 10);
                ctx.fill();
            }
        };
        render();

        return () => cancelAnimationFrame(animationId);
    }, [analyser, color]);

    return (
        <div className="flex flex-col items-center justify-center bg-white px-8 py-6 rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.15)] animate-in fade-in zoom-in duration-300 z-50">
            <div className="text-xs font-bold text-gray-400 mb-4 tracking-[0.2em] uppercase flex items-center gap-2">
                 <Activity size={14} className="text-gray-300"/> VOICE REPLAY
            </div>
            <canvas ref={canvasRef} style={{ width: '220px', height: '60px' }} />
        </div>
    );
};

// --- 工具函数：安全播放音频 (iOS 优化版) ---
const safePlaySound = (type: 'start' | 'go' | 'false' | 'win' | 'test', mode: GameMode) => {
    if (mode === 'VOICE' && type === 'go') return;
    
    // 懒加载全局音频上下文
    if (!sharedAudioCtx) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
            sharedAudioCtx = new AudioContextClass();
        }
    }

    if (!sharedAudioCtx) return;

    // 尝试恢复
    if (sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume().catch(() => {});
    }

    try {
        const ctx = sharedAudioCtx;
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        const now = ctx.currentTime;

        if (type === 'start') {
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(440, now);
            oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.1);
            gainNode.gain.setValueAtTime(0.3, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            oscillator.start(now);
            oscillator.stop(now + 0.1);
        } else if (type === 'go') {
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(880, now);
            gainNode.gain.setValueAtTime(0.5, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            oscillator.start(now);
            oscillator.stop(now + 0.3);
        } else if (type === 'test') {
            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(440, now);
            gainNode.gain.setValueAtTime(0.5, now);
            gainNode.gain.linearRampToValueAtTime(0.01, now + 0.5);
            oscillator.start(now);
            oscillator.stop(now + 0.5);
        } else if (type === 'win') {
            const notes = [523.25, 659.25, 783.99]; 
            notes.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gn = ctx.createGain();
                osc.connect(gn);
                gn.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                gn.gain.setValueAtTime(0.2, now + i * 0.1);
                gn.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.4);
                osc.start(now + i * 0.1);
                osc.stop(now + i * 0.1 + 0.4);
            });
        } else { 
            oscillator.type = 'sawtooth';
            oscillator.frequency.setValueAtTime(150, now);
            gainNode.gain.setValueAtTime(0.5, now);
            gainNode.gain.linearRampToValueAtTime(0.01, now + 0.3);
            oscillator.start(now);
            oscillator.stop(now + 0.3);
        }
    } catch (e) {
        console.error("Sound play error", e);
    }
};

// --- 工具函数：音高检测 ---
const detectPitch = (buffer: Float32Array, sampleRate: number): number => {
    const SIZE = buffer.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.02) return -1; 

    let bestOffset = -1;
    let bestCorrelation = 0;
    let lastCorrelation = 1;

    for (let offset = 0; offset < SIZE; offset++) {
        let correlation = 0;
        for (let i = 0; i < SIZE - offset; i += 2) {
            correlation += Math.abs(buffer[i] - buffer[i + offset]);
        }
        correlation = 1 - (correlation / (SIZE / 2));
        
        if (correlation > 0.9 && correlation > lastCorrelation) {
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = offset;
            }
        }
        lastCorrelation = correlation;
    }
    if (bestCorrelation > 0.01 && bestOffset > 0) {
        return sampleRate / bestOffset;
    }
    return -1;
};

// --- Canvas 绘制圆角矩形辅助函数 ---
function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, fillStyle: string) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
}

export default function App() {
    // --- 状态 ---
    const [gameState, setGameState] = useState<GameState>('IDLE');
    const [gameMode, setGameMode] = useState<GameMode>('TOUCH'); 
    const [winner, setWinner] = useState<Player>(null);
    const [winReason, setWinReason] = useState<WinReason>(null);
    const [reactionTime, setReactionTime] = useState<number>(0);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [detectedFreq, setDetectedFreq] = useState<number>(0); 
    const [currentVolume, setCurrentVolume] = useState<number>(0); 
    
    // 访问量统计状态
    const [visitCount, setVisitCount] = useState<number>(0);

    // 自定义名称状态 (游戏标题 + 玩家名称)
    const [customTitle, setCustomTitle] = useState<string>('');
    const [p1Name, setP1Name] = useState<string>('');
    const [p2Name, setP2Name] = useState<string>('');
    const [maxWaitTime, setMaxWaitTime] = useState<number>(6); // 默认6秒
    
    // 彩头分类选择状态
    const [rewardCategory, setRewardCategory] = useState<RewardCategory>('ALL');
    
    // 用户自定义彩头状态
    const [customRewards, setCustomRewards] = useState<string[]>([]);

    // 综合设置面板状态
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [tempSettings, setTempSettings] = useState({ title: '', p1: '', p2: '', maxWait: 6 });

    // 彩头相关状态
    const [p1Reward, setP1Reward] = useState('');
    const [p2Reward, setP2Reward] = useState('');
    const [p1Masked, setP1Masked] = useState(false);
    const [p2Masked, setP2Masked] = useState(false);
    const [showRewardInput, setShowRewardInput] = useState(false);
    const [isRewardRevealed, setIsRewardRevealed] = useState(false);
    
    // 输入框显示类型状态 (text/password)
    const [p1InputType, setP1InputType] = useState<'text' | 'password'>('text');
    const [p2InputType, setP2InputType] = useState<'text' | 'password'>('text');
    
    // 独立密码锁状态
    const [p1Password, setP1Password] = useState('123456');
    const [p2Password, setP2Password] = useState('123456');
    const [editingPwdPlayer, setEditingPwdPlayer] = useState<Player>(null); 

    const [passwordCheckState, setPasswordCheckState] = useState<{ visible: boolean, player: Player, input: string }>({ visible: false, player: null, input: '' });
    const [viewedRewardContent, setViewedRewardContent] = useState<string | null>(null);

    // 无限模式状态
    const [infiniteStats, setInfiniteStats] = useState<InfiniteRoundRecord[]>([]);
    const [showInfiniteSummary, setShowInfiniteSummary] = useState(false);

    // 战报生成状态
    const [showReportModal, setShowReportModal] = useState(false);
    const [reportImageUrl, setReportImageUrl] = useState<string | null>(null);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);

    // Debug & 状态标识
    const [isMicInitialized, setIsMicInitialized] = useState(false);
    const [isSavingAudio, setIsSavingAudio] = useState(false);
    const [lastRecordingSize, setLastRecordingSize] = useState<number>(0);

    // 回放相关
    const [gameHistory, setGameHistory] = useState<GameLog[]>([]);
    const [isReplaying, setIsReplaying] = useState(false);
    const [replayShockwave, setReplayShockwave] = useState<Player>(null); 
    
    // 专用 Ref: 传递 Analyser 给可视化组件
    const replayAnalyserRef = useRef<AnalyserNode | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- Refs ---
    const timerRef = useRef<number | null>(null);
    const startTimeRef = useRef<number>(0);
    const signalTimeRef = useRef<number>(0);
    const signalTimestampRef = useRef<number>(0); 
    const stateRef = useRef<GameState>('IDLE');
    const historyRecorder = useRef<GameLog[]>([]);
    
    // 同步回放状态到 Ref
    const isReplayingRef = useRef(false);

    // 音频核心
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const micStreamRef = useRef<MediaStream | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordingTimeoutRef = useRef<number | null>(null);
    const recordingStartTimeRef = useRef<number>(0);
    const replaySourceRef = useRef<AudioBufferSourceNode | null>(null);
    const replayTimeoutsRef = useRef<number[]>([]); 

    // 初始化：读取本地存储
    useEffect(() => {
        const savedTitle = localStorage.getItem(STORAGE_KEY_TITLE);
        const savedP1Name = localStorage.getItem(STORAGE_KEY_P1_NAME);
        const savedP2Name = localStorage.getItem(STORAGE_KEY_P2_NAME);
        const savedMaxWait = localStorage.getItem(STORAGE_KEY_MAX_WAIT);
        const savedCustomRewards = localStorage.getItem(STORAGE_KEY_CUSTOM_REWARDS);
        const savedTs = localStorage.getItem(STORAGE_KEY_TS);
        const savedCustomTs = localStorage.getItem(STORAGE_KEY_CUSTOM_TS);
        
        const now = Date.now();

        // 基础设置过期检查
        if (savedTs) {
            const daysDiff = (now - parseInt(savedTs)) / (1000 * 60 * 60 * 24);
            if (daysDiff < 7) {
                if (savedTitle) setCustomTitle(savedTitle);
                if (savedP1Name) setP1Name(savedP1Name);
                if (savedP2Name) setP2Name(savedP2Name);
            } else {
                localStorage.removeItem(STORAGE_KEY_TITLE);
                localStorage.removeItem(STORAGE_KEY_P1_NAME);
                localStorage.removeItem(STORAGE_KEY_P2_NAME);
                localStorage.removeItem(STORAGE_KEY_TS);
            }
        }
        
        // 自定义彩头过期检查
        if (savedCustomRewards && savedCustomTs) {
            const daysDiff = (now - parseInt(savedCustomTs)) / (1000 * 60 * 60 * 24);
            if (daysDiff < 7) {
                 try {
                     setCustomRewards(JSON.parse(savedCustomRewards));
                 } catch (e) {
                     console.error("Failed to parse custom rewards");
                 }
            } else {
                localStorage.removeItem(STORAGE_KEY_CUSTOM_REWARDS);
                localStorage.removeItem(STORAGE_KEY_CUSTOM_TS);
            }
        }
        
        // Max Wait time 独立保存，不过期
        if (savedMaxWait) {
            const mw = parseInt(savedMaxWait);
            if (!isNaN(mw) && mw >= 3) setMaxWaitTime(mw);
        }
    }, []);

    // 新增：加载访问量统计脚本
    useEffect(() => {
        if (!(window as any).BFTCounter) {
            (window as any).BFTCounter = {};
        }

        const scriptSrc = "https://counter.bornforthis.cn/counter.js";
        
        if (document.querySelector(`script[src="${scriptSrc}"]`)) {
             const BFTCounter = (window as any).BFTCounter;
             if (BFTCounter && typeof BFTCounter.get === 'function') {
                 BFTCounter.get().then((data: { total: number }) => {
                     if (data && data.total) setVisitCount(data.total);
                 }).catch((e:any) => console.log(e));
             }
            return;
        }

        const script = document.createElement('script');
        script.src = scriptSrc;
        script.async = true;
        script.dataset.domain = "ai.bornforthis.cn";
        script.dataset.project = "ReadyGoDuel"; 
        
        script.onload = () => {
            const BFTCounter = (window as any).BFTCounter;
            if (BFTCounter && typeof BFTCounter.get === 'function') {
                BFTCounter.get().then((data: { total: number }) => {
                    if (data && data.total) {
                        setVisitCount(data.total);
                    }
                }).catch((err: any) => console.error("Counter fetch failed:", err));
            }
        };

        document.body.appendChild(script);
    }, []);

    // 文件上传处理
    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            if (content) {
                // 按行分割，去除空行和首尾空格
                const lines = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0);
                
                if (lines.length > 0) {
                    setCustomRewards(lines);
                    localStorage.setItem(STORAGE_KEY_CUSTOM_REWARDS, JSON.stringify(lines));
                    localStorage.setItem(STORAGE_KEY_CUSTOM_TS, Date.now().toString());
                    alert(`成功导入 ${lines.length} 个自定义彩头！`);
                } else {
                    alert('文件内容为空或格式不正确');
                }
            }
        };
        reader.readAsText(file);
        // 清空 input value 以便重复上传同一文件
        event.target.value = '';
    };

    // 打开设置面板
    const openSettings = () => {
        setTempSettings({
            title: customTitle,
            p1: p1Name,
            p2: p2Name,
            maxWait: maxWaitTime
        });
        setShowSettingsModal(true);
    };

    // 随机工具函数
    const getRandomItem = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

    // 随机事件处理
    const handleRandomTitle = () => setTempSettings(prev => ({...prev, title: getRandomItem(RANDOM_TITLES)}));
    const handleRandomP1Name = () => setTempSettings(prev => ({...prev, p1: getRandomItem(RANDOM_PLAYER_NAMES)}));
    const handleRandomP2Name = () => setTempSettings(prev => ({...prev, p2: getRandomItem(RANDOM_PLAYER_NAMES)}));

    // 保存设置 (标题和玩家名称)
    const handleSaveSettings = () => {
        const now = Date.now().toString();
        const { title, p1, p2, maxWait } = tempSettings;

        // Title
        if (!title.trim()) {
            setCustomTitle('');
            localStorage.removeItem(STORAGE_KEY_TITLE);
        } else {
            setCustomTitle(title.trim());
            localStorage.setItem(STORAGE_KEY_TITLE, title.trim());
        }

        // P1
        if (!p1.trim()) {
            setP1Name('');
            localStorage.removeItem(STORAGE_KEY_P1_NAME);
        } else {
            setP1Name(p1.trim());
            localStorage.setItem(STORAGE_KEY_P1_NAME, p1.trim());
        }

        // P2
        if (!p2.trim()) {
            setP2Name('');
            localStorage.removeItem(STORAGE_KEY_P2_NAME);
        } else {
            setP2Name(p2.trim());
            localStorage.setItem(STORAGE_KEY_P2_NAME, p2.trim());
        }
        
        // Max Wait
        setMaxWaitTime(maxWait);
        localStorage.setItem(STORAGE_KEY_MAX_WAIT, maxWait.toString());

        // 更新时间戳
        localStorage.setItem(STORAGE_KEY_TS, now);
        setShowSettingsModal(false);
    };

    // 清除所有设置
    const handleClearAllSettings = () => {
        setTempSettings({ title: '', p1: '', p2: '', maxWait: 6 });
    };

    // 同步状态到 Refs
    useEffect(() => { stateRef.current = gameState; }, [gameState]);
    useEffect(() => { isReplayingRef.current = isReplaying; }, [isReplaying]); 

    // iOS 音频解锁监听
    useEffect(() => {
        const unlockAudio = () => {
            if (!sharedAudioCtx) {
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                if (AudioContextClass) sharedAudioCtx = new AudioContextClass();
            }
            if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
                sharedAudioCtx.resume();
            }
        };
        window.addEventListener('touchstart', unlockAudio, { passive: true });
        window.addEventListener('click', unlockAudio, { passive: true });
        window.addEventListener('keydown', unlockAudio, { passive: true });
        return () => {
            window.removeEventListener('touchstart', unlockAudio);
            window.removeEventListener('click', unlockAudio);
            window.removeEventListener('keydown', unlockAudio);
        };
    }, []);

    // 组件卸载清理
    useEffect(() => {
        return () => { fullAudioCleanup(); };
    }, []);

    const fullAudioCleanup = () => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (timerRef.current) clearTimeout(timerRef.current);
        if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
        
        replayTimeoutsRef.current.forEach(t => clearTimeout(t));
        replayTimeoutsRef.current = [];

        if (replaySourceRef.current) {
            try { replaySourceRef.current.stop(); } catch(e) {}
            replaySourceRef.current = null;
        }
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
    };

    // --- 音频引擎初始化 ---
    const initAudioEngine = async () => {
        if (micStreamRef.current && audioContextRef.current?.state === 'running') {
            return true; 
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStreamRef.current = stream;

            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;
            await ctx.resume();

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyserRef.current = analyser;

            const source = ctx.createMediaStreamSource(stream);
            const muteGain = ctx.createGain(); 
            muteGain.gain.value = 0.001; 
            
            source.connect(analyser);
            analyser.connect(muteGain);
            muteGain.connect(ctx.destination);

            setIsMicInitialized(true);
            
            startMonitoringLoop();
            return true;
        } catch (err) {
            console.error("Audio Init Failed", err);
            alert("麦克风启动失败，请检查权限。");
            return false;
        }
    };

    // --- 监听循环 ---
    const startMonitoringLoop = () => {
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        
        const loop = () => {
            if (!analyserRef.current || !audioContextRef.current) return;
            
            if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();

            const bufferLength = analyserRef.current.fftSize;
            const dataArray = new Float32Array(bufferLength);
            analyserRef.current.getFloatTimeDomainData(dataArray);

            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / bufferLength);
            
            const displayVol = Math.min(rms * 15, 1.5); 
            setCurrentVolume(displayVol);

            if ((stateRef.current === 'WAITING' || stateRef.current === 'GO') && !isReplayingRef.current) {
                if (rms > 0.02) { 
                    const pitch = detectPitch(dataArray, audioContextRef.current.sampleRate);
                    handleVoiceTrigger(pitch);
                }
            }

            animationFrameRef.current = requestAnimationFrame(loop);
        };
        loop();
    };

    // --- 战报生成逻辑 ---
    const generateBattleReport = async () => {
        setIsGeneratingReport(true);
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const isInfiniteReport = gameMode === 'INFINITE' && showInfiniteSummary;
            const width = 600;
            
            // 动态高度计算
            let height = 800; // 默认单局高度
            if (isInfiniteReport) {
                height = 1000; // 降低高度，原1100
            }
            
            canvas.width = width;
            canvas.height = height;

            // 1. 背景色 (纯白)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);

            // 2. 标题
            ctx.fillStyle = '#1e293b'; // slate-800
            ctx.font = 'bold 44px sans-serif';
            ctx.textAlign = 'center';
            
            // 动态标题逻辑
            let title = 'Ready Go Duel 战报';
            if (isInfiniteReport) {
                title = customTitle ? `${customTitle} 战报` : '∞ 无限世界战报';
            } else {
                title = customTitle ? `${customTitle} 战报` : 'Ready Go Duel 战报';
            }

            // 处理标题过长自动缩放
            if (ctx.measureText(title).width > width - 40) {
                 ctx.font = 'bold 32px sans-serif';
            }
            ctx.fillText(title, width / 2, 80);

            // 3. 时间
            const now = new Date();
            const timeString = now.toLocaleString('zh-CN', { 
                year: 'numeric', month: '2-digit', day: '2-digit', 
                hour: '2-digit', minute: '2-digit', second: '2-digit' 
            });
            ctx.fillStyle = '#64748b'; // slate-500
            ctx.font = '20px sans-serif';
            ctx.fillText(timeString, width / 2, 120);

            // 获取玩家显示名称
            const p1DisplayName = p1Name || '红方';
            const p2DisplayName = p2Name || '蓝方';

            // 4. 内容区域
            if (isInfiniteReport) {
                const p1Wins = infiniteStats.filter(r => r.winner === 'p1').length;
                const p2Wins = infiniteStats.filter(r => r.winner === 'p2').length;
                const total = infiniteStats.length;

                // 最终胜负 (顶部区域)
                let resultText = "势均力敌";
                let resultColor = "#64748b"; // gray
                if (p1Wins > p2Wins) {
                    resultText = `${p1DisplayName}最终胜利!`;
                    resultColor = "#f43f5e"; // rose
                } else if (p2Wins > p1Wins) {
                    resultText = `${p2DisplayName}最终胜利!`;
                    resultColor = "#0ea5e9"; // blue
                }

                ctx.fillStyle = resultColor;
                // 动态调整胜负字号
                let resultFontSize = 64;
                if (resultText.length > 6) resultFontSize = 48;
                if (resultText.length > 10) resultFontSize = 36;
                ctx.font = `bold ${resultFontSize}px sans-serif`;
                ctx.fillText(resultText, width / 2, 210); 

                // 数据统计盒
                const statBoxY = 270; 
                drawRoundedRect(ctx, 40, statBoxY, 520, 160, 24, '#f8fafc'); 

                // 总对局
                ctx.fillStyle = '#334155';
                ctx.font = 'bold 24px sans-serif';
                ctx.fillText("总对局", width / 2, statBoxY + 50);
                ctx.font = 'bold 50px sans-serif';
                ctx.fillText(total.toString(), width / 2, statBoxY + 110);

                // 红方胜场
                ctx.textAlign = 'center';
                ctx.fillStyle = '#f43f5e';
                ctx.font = 'bold 24px sans-serif';
                // 截断过长名字
                let p1Label = p1DisplayName;
                if (p1Label.length > 4) p1Label = p1Label.substring(0, 3) + '..';
                ctx.fillText(p1Label + '胜', 130, statBoxY + 50);
                ctx.font = 'bold 50px sans-serif';
                ctx.fillText(p1Wins.toString(), 130, statBoxY + 110);

                // 蓝方胜场
                ctx.fillStyle = '#0ea5e9';
                ctx.font = 'bold 24px sans-serif';
                let p2Label = p2DisplayName;
                if (p2Label.length > 4) p2Label = p2Label.substring(0, 3) + '..';
                ctx.fillText(p2Label + '胜', 470, statBoxY + 50);
                ctx.font = 'bold 50px sans-serif';
                ctx.fillText(p2Wins.toString(), 470, statBoxY + 110);

                // 列表标题
                const listStartY = 460; 
                ctx.textAlign = 'left';
                ctx.fillStyle = '#334155';
                ctx.font = 'bold 24px sans-serif';
                ctx.fillText('最近战绩 (Last 3)', 40, listStartY);

                // 只取最后3场
                const recentStats = [...infiniteStats].reverse().slice(0, 3);
                
                let itemY = listStartY + 30;
                
                if (recentStats.length === 0) {
                     ctx.fillStyle = '#94a3b8';
                     ctx.font = '20px sans-serif';
                     ctx.fillText('暂无对战记录', 40, itemY + 40);
                }

                recentStats.forEach((round) => {
                    // 行背景
                    drawRoundedRect(ctx, 40, itemY, 520, 70, 12, '#f8fafc'); // slate-50
                    
                    // 序号 #1
                    ctx.textAlign = 'left';
                    ctx.fillStyle = '#94a3b8'; // slate-400
                    ctx.font = 'bold 20px sans-serif';
                    ctx.fillText(`#${round.roundNumber}`, 60, itemY + 42);

                    // 胜者
                    ctx.font = 'bold 24px sans-serif';
                    if (round.winner === 'p1') {
                        ctx.fillStyle = '#f43f5e'; // rose-500
                        ctx.fillText(`${p1DisplayName}胜`, 120, itemY + 42);
                    } else {
                        ctx.fillStyle = '#0ea5e9'; // sky-500
                        ctx.fillText(`${p2DisplayName}胜`, 120, itemY + 42);
                    }

                    // 奖励
                    ctx.textAlign = 'right';
                    ctx.fillStyle = '#475569'; // slate-600
                    ctx.font = '20px sans-serif';
                    // 截断过长文字
                    let rewardText = round.reward;
                    if (rewardText.length > 12) rewardText = rewardText.substring(0, 11) + '...';
                    ctx.fillText(`赢走: ${rewardText}`, 540, itemY + 42);

                    itemY += 90; // 70px height + 20px gap
                });

            } else {
                // --- 单局模式绘制逻辑 ---
                const primaryColor = winner === 'p1' ? '#f43f5e' : (winner === 'p2' ? '#0ea5e9' : '#64748b');
                
                // 顶部装饰条
                ctx.fillStyle = primaryColor;
                ctx.fillRect(0, 0, width, 20);

                // 胜负大字
                ctx.textAlign = 'center';
                ctx.fillStyle = primaryColor;
                
                // 动态调整字号以适应长名字
                const winnerText = winner === 'p1' ? `${p1DisplayName}胜` : (winner === 'p2' ? `${p2DisplayName}胜` : '平局');
                let winFontSize = 80;
                if (winnerText.length > 4) winFontSize = 60;
                if (winnerText.length > 8) winFontSize = 40;
                ctx.font = `bold ${winFontSize}px sans-serif`;
                
                ctx.fillText(winnerText, width / 2, 220);

                // 详情
                ctx.fillStyle = '#334155';
                ctx.font = '24px sans-serif';
                let yPos = 300;
                
                const modeName = gameMode === 'INFINITE' ? '无限世界' : (gameMode === 'TOUCH' ? '触摸模式' : '声控模式');
                
                ctx.fillText(`模式: ${modeName}`, width / 2, yPos); yPos += 50;
                
                if (winReason === 'REACTION') {
                    ctx.fillText(`反应时间: ${reactionTime} ms`, width / 2, yPos); yPos += 50;
                } else if (winReason === 'FALSE_START') {
                    ctx.fillText(`获胜原因: 对方抢跑`, width / 2, yPos); yPos += 50;
                } else if (winReason === 'VOICE_TRIGGER') {
                    ctx.fillText(`触发频率: ${detectedFreq} Hz`, width / 2, yPos); yPos += 50;
                }

                // 彩头
                const reward = winner === 'p1' ? p1Reward : p2Reward;
                if (reward) {
                     yPos += 30;
                     drawRoundedRect(ctx, 50, yPos - 50, 500, 100, 20, '#fff7ed'); // orange-50
                     ctx.fillStyle = '#ea580c'; // orange-600
                     ctx.font = 'bold 36px sans-serif';
                     ctx.fillText(`赢取: ${reward}`, width / 2, yPos + 15);
                }
            }

            // 5. 底部 Footer (二维码)
            const qrSize = isInfiniteReport ? 150 : 200;
            const footerY = height - (isInfiniteReport ? 220 : 280);
            
            // 绘制二维码
            const qrUrl = "https://ai.bornforthis.cn/images/ReadyGoDuel.png";
            
            const qrImg = new Image();
            qrImg.crossOrigin = "Anonymous"; 
            qrImg.src = qrUrl;

            await new Promise((resolve) => {
                qrImg.onload = resolve;
                qrImg.onerror = () => {
                    console.warn("QR Code load failed");
                    ctx.fillStyle = '#cbd5e1';
                    ctx.fillRect((width - qrSize) / 2, footerY, qrSize, qrSize);
                    resolve(null);
                };
            });

            if (qrImg.complete && qrImg.naturalWidth !== 0) {
                 ctx.drawImage(qrImg, (width - qrSize) / 2, footerY, qrSize, qrSize);
            }

            // 底部 Slogan
            ctx.textAlign = 'center';
            ctx.fillStyle = '#64748b'; // slate-500
            ctx.font = 'bold 20px sans-serif';
            ctx.fillText("扫码挑战 Ready Go Duel", width / 2, footerY + qrSize + 40);

            // 生成图片 URL
            const dataUrl = canvas.toDataURL('image/png');
            setReportImageUrl(dataUrl);
            setShowReportModal(true);

        } catch (e) {
            console.error("Generate Report Failed", e);
            alert("战报生成失败，请重试");
        } finally {
            setIsGeneratingReport(false);
        }
    };


    // --- 游戏流程控制 ---

    const switchGameMode = (newMode: GameMode) => {
        fullAudioCleanup();
        setGameState('IDLE');
        setWinner(null);
        setWinReason(null);
        setReplayShockwave(null);
        setIsReplaying(false);
        setIsSavingAudio(false);
        setGameHistory([]); 
        setGameMode(newMode);
        setIsRewardRevealed(false);
        setInfiniteStats([]); // 重置无限模式数据
        setShowInfiniteSummary(false);
        // 彩头不清除，方便继续
    };

    const handleStartClick = () => {
        setShowRewardInput(true);
        setViewedRewardContent(null);
        setEditingPwdPlayer(null);
        // 重置输入框类型为 text，方便输入中文
        setP1InputType('text');
        setP2InputType('text');
    };

    const handleRandomReward = (player: 'p1' | 'p2') => {
        // 根据当前选中的分类，从对应的池子中获取
        // 如果选中 CUSTOM，则从 customRewards 中获取，如果没有自定义彩头，则回退到 RANDOM_REWARDS
        let pool: string[] = [];
        
        if (rewardCategory === 'CUSTOM') {
             pool = customRewards.length > 0 ? customRewards : RANDOM_REWARDS;
        } else {
             pool = REWARD_POOLS[rewardCategory as Exclude<RewardCategory, 'CUSTOM'>] || RANDOM_REWARDS;
        }
        
        const randomReward = pool[Math.floor(Math.random() * pool.length)];
        
        if (player === 'p1') {
            setP1Reward(randomReward);
            setP1Masked(false); 
            setP1InputType('text'); // 随机生成后设为可见
        } else {
            setP2Reward(randomReward);
            setP2Masked(false);
            setP2InputType('text');
        }
    };

    const lockReward = (player: 'p1' | 'p2') => {
        if (player === 'p1' && p1Reward.trim()) setP1Masked(true);
        if (player === 'p2' && p2Reward.trim()) setP2Masked(true);
    };

    const clearAndUnlock = (player: 'p1' | 'p2') => {
        if (player === 'p1') {
            setP1Reward('');
            setP1Masked(false);
            setP1InputType('text'); // 重置为text方便输入
        } else {
            setP2Reward('');
            setP2Masked(false);
            setP2InputType('text');
        }
    };

    const toggleInputType = (player: 'p1' | 'p2') => {
        if (player === 'p1') {
            setP1InputType(prev => prev === 'text' ? 'password' : 'text');
        } else {
            setP2InputType(prev => prev === 'text' ? 'password' : 'text');
        }
    };

    const initiatePasswordCheck = (player: 'p1' | 'p2') => {
        setPasswordCheckState({ visible: true, player, input: '' });
        setViewedRewardContent(null);
    };

    const verifyPassword = () => {
        const targetPwd = passwordCheckState.player === 'p1' ? p1Password : p2Password;
        if (passwordCheckState.input === targetPwd) {
            const content = passwordCheckState.player === 'p1' ? p1Reward : p2Reward;
            setViewedRewardContent(content);
            setPasswordCheckState(prev => ({ ...prev, visible: false }));
        } else {
            alert('密码错误');
        }
    };

    const togglePwdSetting = (player: Player) => {
        if (editingPwdPlayer === player) {
            setEditingPwdPlayer(null);
        } else {
            setEditingPwdPlayer(player);
        }
    };

    // 无限模式：下一轮
    const handleNextRound = () => {
        // 自动随机彩头
        let pool: string[] = [];
        if (rewardCategory === 'CUSTOM') {
             pool = customRewards.length > 0 ? customRewards : RANDOM_REWARDS;
        } else {
             pool = REWARD_POOLS[rewardCategory as Exclude<RewardCategory, 'CUSTOM'>] || RANDOM_REWARDS;
        }

        const r1 = pool[Math.floor(Math.random() * pool.length)];
        const r2 = pool[Math.floor(Math.random() * pool.length)];
        
        setP1Reward(r1);
        setP2Reward(r2);
        setP1Masked(true); // 自动遮罩
        setP2Masked(true);
        
        launchGame();
    };

    // 无限模式：退出
    const handleExitInfinite = () => {
        setShowInfiniteSummary(true);
    };

    const launchGame = async () => {
        // 如果有内容未锁定，自动锁定
        if (p1Reward) setP1Masked(true);
        if (p2Reward) setP2Masked(true);

        setShowRewardInput(false); 
        setIsRewardRevealed(false); 
        setViewedRewardContent(null);
        setEditingPwdPlayer(null);
        
        fullAudioCleanup();
        setIsSavingAudio(false); 
        setReplayShockwave(null);
        setIsReplaying(false);
        isReplayingRef.current = false; 

        if (gameMode === 'VOICE') {
            if (!isMicInitialized) {
                const success = await initAudioEngine();
                if (!success) { switchGameMode('TOUCH'); return; } 
            }
            startMonitoringLoop();
            startRecording(); 
        }

        setGameState('WAITING');
        setWinner(null);
        setWinReason(null);
        setReactionTime(0);
        setDetectedFreq(0);
        setLastRecordingSize(0);
        historyRecorder.current = [];
        
        if (soundEnabled) safePlaySound('start', gameMode);

        const now = Date.now();
        startTimeRef.current = now;
        historyRecorder.current.push({ step: 'WAITING', timestamp: 0 });

        // 根据设置的最大等待时间计算随机延迟
        // 最小 2000ms，最大 maxWaitTime * 1000 ms
        const minDelay = 2000;
        const maxDelay = Math.max(3000, maxWaitTime * 1000); // 确保至少有1秒的随机区间
        const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
        
        timerRef.current = setTimeout(triggerSignal, randomDelay);
    };

    const startRecording = () => {
        if (!micStreamRef.current) return;
        audioChunksRef.current = [];
        recordingStartTimeRef.current = Date.now();

        try {
            const recorder = new MediaRecorder(micStreamRef.current);
            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
            };
            recorder.start();
            mediaRecorderRef.current = recorder;
        } catch (e) {
            console.error("Recorder error", e);
        }
    };

    const triggerSignal = () => {
        if (stateRef.current !== 'WAITING') return;

        const now = Date.now();
        signalTimeRef.current = now;
        signalTimestampRef.current = now;
        setGameState('GO');
        if (soundEnabled) safePlaySound('go', gameMode);
        historyRecorder.current.push({ step: 'GO', timestamp: now - startTimeRef.current });
    };

    const handleVoiceTrigger = (pitch: number) => {
        if (isReplayingRef.current) return;
        if (stateRef.current !== 'WAITING' && stateRef.current !== 'GO') return;

        setDetectedFreq(Math.round(pitch));
        let guessedWinner: Player = 'p1';
        if (pitch > 0) {
            guessedWinner = pitch > 200 ? 'p1' : 'p2'; 
        }
        finishGame(guessedWinner);
    };

    const handleTouchAction = (player: 'p1' | 'p2') => {
        if (stateRef.current !== 'WAITING' && stateRef.current !== 'GO') return;
        finishGame(player);
    };

    const finishGame = (triggerPlayer: Player) => {
        if (timerRef.current) clearTimeout(timerRef.current);

        const now = Date.now();
        let finalWinner = triggerPlayer;
        let finalReason: WinReason = 'REACTION';
        let timeDiff = 0;

        if (stateRef.current === 'WAITING') {
            finalWinner = triggerPlayer === 'p1' ? 'p2' : 'p1';
            finalReason = 'FALSE_START';
            if (soundEnabled) safePlaySound('false', gameMode);
        } else {
            timeDiff = now - signalTimeRef.current;
            finalReason = 'REACTION';
            if (soundEnabled) safePlaySound('win', gameMode);
        }

        setGameState('ENDED');
        setWinner(finalWinner);
        setWinReason(finalReason);
        setReactionTime(timeDiff);

        // --- 无限模式数据记录 ---
        if (gameMode === 'INFINITE') {
            const rewardWon = finalWinner === 'p1' ? p1Reward : p2Reward;
            setInfiniteStats(prev => [...prev, {
                roundNumber: prev.length + 1,
                winner: finalWinner,
                reward: rewardWon || '无彩头',
                timestamp: now
            }]);
        }

        const logEntry: GameLog = {
            step: 'END',
            timestamp: now - startTimeRef.current,
            winner: finalWinner,
            winReason: finalReason,
            reactionTime: timeDiff,
            recordingStartTime: recordingStartTimeRef.current,
            triggerTimestamp: now,
            signalTimestamp: signalTimestampRef.current
        };
        historyRecorder.current.push(logEntry);
        setGameHistory([...historyRecorder.current]);

        if (gameMode === 'VOICE') {
            setIsSavingAudio(true);
            recordingTimeoutRef.current = setTimeout(() => {
                stopAndSaveRecording(logEntry);
            }, 1500);
        } else {
            stopAndSaveRecording(logEntry);
        }
    };

    const stopAndSaveRecording = (logEntry: GameLog) => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.requestData();
            mediaRecorderRef.current.stop();
            
            setTimeout(() => {
                const totalSize = audioChunksRef.current.reduce((acc, chunk) => acc + chunk.size, 0);
                setLastRecordingSize(totalSize);

                if (totalSize > 0) {
                    const mime = mediaRecorderRef.current?.mimeType || 'audio/webm';
                    const blob = new Blob(audioChunksRef.current, { type: mime });
                    logEntry.audioBlob = blob;
                    logEntry.blobSize = totalSize;
                    setGameHistory([...historyRecorder.current]);
                }
                setIsSavingAudio(false); 
            }, 100);
        } else {
            setIsSavingAudio(false);
        }
    };

    const startReplay = async () => {
        if (gameHistory.length === 0 || gameState !== 'ENDED') return;
        setIsReplaying(true);
        setReplayShockwave(null);

        const endFrame = gameHistory.find(h => h.step === 'END');
        if (!endFrame) { setIsReplaying(false); return; }

        let seekOffset = 0; 
        if (endFrame.audioBlob && endFrame.recordingStartTime && endFrame.triggerTimestamp) {
            const triggerTime = endFrame.triggerTimestamp;
            const recStart = endFrame.recordingStartTime;
            const idealPlayStart = triggerTime - 500; 
            seekOffset = Math.max(0, (idealPlayStart - recStart) / 1000);
        }

        if (endFrame.audioBlob) {
            await playBlobSlice(endFrame.audioBlob, seekOffset);
        }

        const t1 = setTimeout(() => {
            if (!isReplayingRef.current) return;
            setReplayShockwave(endFrame.winner || null);
        }, 500);

        const t2 = setTimeout(() => {
            setIsReplaying(false);
            setReplayShockwave(null);
            replayAnalyserRef.current = null;
            if (replaySourceRef.current) {
                try { replaySourceRef.current.stop(); } catch(e){}
            }
        }, 2500); 

        replayTimeoutsRef.current.push(t1, t2);
    };

    const playBlobSlice = async (blob: Blob, offset: number) => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;

            const gainNode = ctx.createGain();
            gainNode.gain.value = 8.0; 

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 64; 
            replayAnalyserRef.current = analyser; 

            source.connect(analyser);
            analyser.connect(gainNode);
            gainNode.connect(ctx.destination);

            replaySourceRef.current = source;
            source.start(0, offset); 
        } catch (e) {
            console.error("Replay Error", e);
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
            if (showRewardInput || showSettingsModal) {
                if (e.key === 'Enter' && !e.isComposing) {
                    if (showSettingsModal) {
                         handleSaveSettings();
                    } else if (passwordCheckState.visible) {
                        verifyPassword();
                    } else {
                        launchGame();
                    }
                }
                return;
            }
            
            if (gameMode === 'VOICE' && gameState !== 'IDLE') return; 
            if (gameMode !== 'INFINITE' && e.code === 'Space' && gameState === 'IDLE' && !isReplaying) handleStartClick(); 
            if (gameMode === 'TOUCH' || gameMode === 'INFINITE') {
                 if (e.key.toLowerCase() === 'a') handleTouchAction('p1');
                 if (e.key.toLowerCase() === 'l') handleTouchAction('p2');
            }
        };
        
        window.addEventListener('keydown', handleKeyDown as any);
        return () => window.removeEventListener('keydown', handleKeyDown as any);
    }, [gameState, isReplaying, gameMode, showRewardInput, showSettingsModal, launchGame, passwordCheckState, p1Password, p2Password, tempSettings]);

    // --- UI 组件 ---
    const PlayerZone = ({ id, defaultLabel, colorClass, keyLabel, subLabel, hasReward, currentName }: { id: 'p1' | 'p2', defaultLabel: string, colorClass: string, keyLabel: string, subLabel?: string, hasReward?: boolean, currentName: string }) => {
        const isWinner = gameState === 'ENDED' && winner === id;
        const isLoser = gameState === 'ENDED' && winner !== id && winner !== null;
        let bgColor = colorClass;
        if (gameState === 'ENDED') {
            if (isWinner) bgColor = id === 'p1' ? 'bg-rose-500' : 'bg-sky-500';
            else if (isLoser) bgColor = 'bg-gray-100 grayscale opacity-40';
        }
        if (isReplaying && gameState === 'ENDED' && !isWinner) bgColor = 'bg-gray-200 opacity-30';
        const rotationClass = id === 'p1' ? 'rotate-180 md:rotate-0' : '';
        const showShockwave = isReplaying && replayShockwave === id;

        // 显示的名字
        const displayName = currentName || defaultLabel;

        let IconComponent;
        if (isWinner && !isReplaying) {
            IconComponent = <Trophy size={80} className="text-yellow-300 drop-shadow-lg animate-bounce sm:w-36 sm:h-36" fill="currentColor" />;
        } else if (gameMode === 'VOICE') {
            IconComponent = <Mic size={80} className="text-gray-800/20 transition-colors duration-300 sm:w-28 sm:h-28" />;
        } else {
            IconComponent = <Hand size={80} strokeWidth={1.5} className="text-gray-800/20 transition-colors duration-300 sm:w-28 sm:h-28" />;
        }

        return (
            <div 
                className={`flex-1 relative flex flex-col items-center justify-center transition-all duration-300 touch-manipulation select-none overflow-hidden ${bgColor}`}
                onPointerDown={(e) => {
                    if (gameMode !== 'VOICE') { e.preventDefault(); handleTouchAction(id); }
                }}
            >
                <div className={`flex flex-col items-center justify-center w-full h-full p-4 gap-4 ${rotationClass}`}>
                    <div className={`transform transition-all duration-300 ${isWinner && !isReplaying ? 'scale-110 -translate-y-2' : ''}`}>
                        {isLoser && winReason === 'FALSE_START' ? (
                             <div className="flex flex-col items-center text-red-500/80 font-bold animate-pulse">
                                <AlertTriangle size={60} className="sm:w-20 sm:h-20" /> <span className="text-xl mt-2 sm:text-2xl">抢跑!</span>
                            </div>
                        ) : (
                            <div className="relative">
                                {showShockwave && (
                                    <>
                                        <div className="absolute inset-0 rounded-full bg-white opacity-80 animate-ping" style={{ animationDuration: '0.6s' }}></div>
                                        <div className="absolute -inset-8 rounded-full border-4 border-white opacity-60 animate-ping" style={{ animationDuration: '1s' }}></div>
                                        <div className="absolute -inset-16 flex items-center justify-center z-20">
                                            <Zap size={100} className="text-yellow-300 drop-shadow-lg animate-pulse" fill="currentColor"/>
                                        </div>
                                    </>
                                )}
                                {IconComponent}
                            </div>
                        )}
                    </div>
                    <div className={`text-center z-10 relative group ${isWinner ? 'text-white' : 'text-gray-600/60'}`}>
                        <div className="flex items-center justify-center gap-2 relative">
                            <h2 className="text-2xl sm:text-3xl font-black tracking-wider truncate max-w-[200px] sm:max-w-[300px]" title={displayName}>{displayName}</h2>
                            {hasReward && !isWinner && !isLoser && (
                                <div className="bg-yellow-100 text-yellow-600 p-1 rounded-full shadow-sm animate-fade-in" title="彩头已锁定">
                                    <Lock size={12} className="sm:w-4 sm:h-4" />
                                </div>
                            )}
                        </div>
                        {gameMode === 'VOICE' && subLabel && !showShockwave && (
                            <p className={`text-xs sm:text-sm font-bold mt-1 ${isWinner ? 'text-white/90' : 'text-gray-500'}`}>{subLabel}</p>
                        )}
                        <p className="text-xs sm:text-sm font-medium mt-1 opacity-70 hidden md:block">{gameMode === 'VOICE' ? '喊出声音!' : keyLabel}</p>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="w-full h-[100dvh] flex flex-col bg-white overflow-hidden font-sans relative">
            {/* 撒礼花特效 (回放时隐藏) */}
            {gameState === 'ENDED' && !isReplaying && winner && winReason !== 'FALSE_START' && <Confetti />}

            {/* --- 顶部导航栏 --- */}
            <div className="h-16 bg-white/90 backdrop-blur shadow-sm flex items-center justify-between px-4 z-40 shrink-0 absolute top-0 left-0 right-0 w-full">
                <a href="https://bornforthis.cn/" target="_blank" rel="noreferrer" className="flex items-center gap-2 group hover:opacity-80 transition-opacity">
                    <CustomLogo className="w-8 h-8" />
                    <span className="font-bold text-gray-700 hidden md:block">AI悦创编程私教</span>
                    <span className="font-bold text-gray-700 md:hidden">AI悦创</span>
                </a>
                <div className="flex items-center gap-3">
                    <div className="flex bg-gray-100 rounded-full p-1 gap-1">
                        <button onClick={() => switchGameMode('TOUCH')} className={`p-1.5 rounded-full transition-all ${gameMode === 'TOUCH' ? 'bg-white shadow text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`} title="触摸模式"><Hand size={16}/></button>
                        <button onClick={() => switchGameMode('VOICE')} className={`p-1.5 rounded-full transition-all ${gameMode === 'VOICE' ? 'bg-white shadow text-rose-600' : 'text-gray-400 hover:text-gray-600'}`} title="声控模式"><Mic size={16}/></button>
                        <button onClick={() => switchGameMode('INFINITE')} className={`p-1.5 rounded-full transition-all ${gameMode === 'INFINITE' ? 'bg-white shadow text-purple-600' : 'text-gray-400 hover:text-gray-600'}`} title="无限世界"><Infinity size={16}/></button>
                    </div>
                    
                    <button 
                        onClick={openSettings} 
                        className={`p-2 rounded-full transition-colors ${customTitle || p1Name || p2Name ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100' : 'text-gray-400 bg-gray-50 hover:bg-gray-100'}`}
                        title="游戏设置"
                    >
                        <Settings size={20} />
                    </button>

                    <button 
                        onClick={() => setSoundEnabled(!soundEnabled)} 
                        className={`p-2 rounded-full transition-colors ${soundEnabled ? 'text-gray-600 hover:bg-gray-100' : 'text-gray-400 bg-gray-50'}`}
                    >
                        {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                    </button>
                    
                    {gameState === 'ENDED' && !isReplaying && gameMode !== 'INFINITE' && (
                        <button 
                            onClick={handleStartClick} 
                            className={`p-2 rounded-full shadow-lg text-white transition-all active:scale-90 ${isSavingAudio ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}`} 
                            disabled={isSavingAudio}
                        >
                            {isSavingAudio ? <Loader2 size={20} className="animate-spin" /> : <RotateCcw size={20} />}
                        </button>
                    )}
                </div>
            </div>

            {/* 综合设置面板 */}
            {showSettingsModal && (
                <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm scale-100 animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh] overflow-y-auto">
                        <h3 className="text-xl font-black text-gray-800 mb-4 flex items-center gap-2 sticky top-0 bg-white z-10">
                            <Settings className="text-indigo-600"/> 游戏设置
                        </h3>
                        
                        <div className="space-y-4 mb-6">
                            {/* 游戏标题设置 */}
                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1 ml-1 uppercase">游戏标题 (Game Title)</label>
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        placeholder="例如：谁是今晚洗碗王"
                                        value={tempSettings.title}
                                        onChange={(e) => setTempSettings({...tempSettings, title: e.target.value})}
                                        className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-100 rounded-xl focus:outline-none focus:border-indigo-500 focus:bg-white transition-all text-gray-800 font-bold pr-12"
                                        maxLength={15}
                                    />
                                    <button 
                                        onClick={handleRandomTitle}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                        title="随机标题"
                                    >
                                        <Dices size={20}/>
                                    </button>
                                </div>
                            </div>

                            <div className="flex gap-3">
                                {/* P1 名称设置 */}
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-rose-500 mb-1 ml-1 uppercase">红方昵称</label>
                                    <div className="relative">
                                        <input 
                                            type="text" 
                                            placeholder="红方"
                                            value={tempSettings.p1}
                                            onChange={(e) => setTempSettings({...tempSettings, p1: e.target.value})}
                                            className="w-full px-4 py-3 bg-rose-50 border-2 border-rose-100 rounded-xl focus:outline-none focus:border-rose-500 focus:bg-white transition-all text-gray-800 font-bold pr-10"
                                            maxLength={8}
                                        />
                                        <button 
                                            onClick={handleRandomP1Name}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-rose-300 hover:text-rose-600 hover:bg-rose-100 rounded-lg transition-colors"
                                            title="随机昵称"
                                        >
                                            <Dices size={18}/>
                                        </button>
                                    </div>
                                </div>

                                {/* P2 名称设置 */}
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-sky-500 mb-1 ml-1 uppercase">蓝方昵称</label>
                                    <div className="relative">
                                        <input 
                                            type="text" 
                                            placeholder="蓝方"
                                            value={tempSettings.p2}
                                            onChange={(e) => setTempSettings({...tempSettings, p2: e.target.value})}
                                            className="w-full px-4 py-3 bg-sky-50 border-2 border-sky-100 rounded-xl focus:outline-none focus:border-sky-500 focus:bg-white transition-all text-gray-800 font-bold pr-10"
                                            maxLength={8}
                                        />
                                        <button 
                                            onClick={handleRandomP2Name}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-sky-300 hover:text-sky-600 hover:bg-sky-100 rounded-lg transition-colors"
                                            title="随机昵称"
                                        >
                                            <Dices size={18}/>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* 随机等待时间设置 */}
                            <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                                <label className="block text-xs font-bold text-gray-500 mb-2 ml-1 uppercase flex items-center gap-1">
                                    <Clock size={14}/> 随机等待时间 (2s ~ {tempSettings.maxWait}s)
                                </label>
                                <input 
                                    type="range" 
                                    min="3" 
                                    max="10" 
                                    step="1"
                                    value={tempSettings.maxWait}
                                    onChange={(e) => setTempSettings({...tempSettings, maxWait: parseInt(e.target.value)})}
                                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                />
                                <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-mono">
                                    <span>快 (3s)</span>
                                    <span>慢 (10s)</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-auto">
                            <button 
                                onClick={handleClearAllSettings}
                                className="px-4 py-3 bg-red-50 text-red-500 rounded-xl font-bold hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                                title="重置所有设置"
                            >
                                <Trash2 size={18}/>
                            </button>
                            <button 
                                onClick={() => setShowSettingsModal(false)} 
                                className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                            >
                                取消
                            </button>
                            <button 
                                onClick={handleSaveSettings} 
                                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
                            >
                                <Save size={18}/> 保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 彩头输入弹窗 */}
            {showRewardInput && (
                <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md scale-100 animate-in zoom-in-95 duration-200 overflow-y-auto max-h-[85dvh] flex flex-col">
                        <div className="flex items-center justify-center gap-2 mb-2 sm:mb-4 text-gray-800 shrink-0">
                            {gameMode === 'INFINITE' ? <Infinity className="text-purple-600"/> : <Gift className="text-indigo-500" />}
                            <h2 className="text-xl font-black tracking-tight">{gameMode === 'INFINITE' ? '无限世界·首局设定' : '本局彩头'}</h2>
                        </div>
                        
                        <div className="space-y-4 sm:space-y-6 mb-4 sm:mb-6 overflow-y-auto flex-1">
                            
                            {/* 分类选择器 */}
                            <div className="flex flex-wrap gap-2">
                                {Object.keys(CATEGORY_LABELS).map((cat) => {
                                    // 仅当有自定义彩头时显示 CUSTOM 标签
                                    if (cat === 'CUSTOM' && customRewards.length === 0) return null;
                                    return (
                                        <button
                                            key={cat}
                                            onClick={() => setRewardCategory(cat as RewardCategory)}
                                            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors flex items-center gap-1
                                                ${rewardCategory === cat 
                                                    ? 'bg-indigo-600 text-white shadow-md' 
                                                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                        >
                                            {CATEGORY_LABELS[cat as RewardCategory]}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* P1 输入区 */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-rose-500 uppercase tracking-wider ml-1">
                                    {p1Name || 'P1 红方'} 赢了想要...
                                </label>
                                <div className="flex gap-2 relative">
                                    {!p1Masked ? (
                                        <>
                                            <div className="relative flex-1">
                                                <input 
                                                    type={p1InputType}
                                                    autoComplete="off"
                                                    value={p1Reward}
                                                    onChange={(e) => setP1Reward(e.target.value)}
                                                    placeholder="例: 免洗碗券一张" 
                                                    className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-rose-50 border-2 border-rose-100 rounded-xl focus:outline-none focus:border-rose-400 focus:ring-4 focus:ring-rose-100 transition-all text-gray-700 font-medium placeholder:text-rose-300/70"
                                                />
                                                <button 
                                                    onClick={() => toggleInputType('p1')}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-rose-400/60 hover:text-rose-500 transition-colors p-1"
                                                    title={p1InputType === 'text' ? '隐藏内容(密文)' : '显示内容(明文)'}
                                                >
                                                    {p1InputType === 'text' ? <EyeOff size={16}/> : <Eye size={16}/>}
                                                </button>
                                            </div>
                                            <button onClick={() => lockReward('p1')} className="px-2 sm:px-3 bg-rose-100 text-rose-500 rounded-xl hover:bg-rose-200" title="锁定并隐藏"><Lock size={18} className="sm:w-5 sm:h-5"/></button>
                                            <button onClick={() => handleRandomReward('p1')} className="px-2 sm:px-3 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200" title={`随机生成 (${CATEGORY_LABELS[rewardCategory]})`}><Dices size={18} className="sm:w-5 sm:h-5"/></button>
                                            <button onClick={() => togglePwdSetting('p1')} className={`px-2 sm:px-3 rounded-xl hover:bg-gray-200 transition-colors ${editingPwdPlayer==='p1' ? 'bg-gray-200 text-gray-800' : 'bg-gray-100 text-gray-500'}`} title="设置密码"><KeyRound size={18} className="sm:w-5 sm:h-5"/></button>
                                        </>
                                    ) : (
                                        <>
                                            <div 
                                                onClick={() => clearAndUnlock('p1')}
                                                className="flex-1 px-3 sm:px-4 py-2 sm:py-3 bg-rose-100 border-2 border-rose-200 rounded-xl text-rose-400 font-black tracking-widest cursor-pointer hover:bg-rose-200 flex items-center justify-between"
                                            >
                                                <span>******</span>
                                                <span className="text-[10px] font-normal opacity-70">点击清空重填</span>
                                            </div>
                                            <button onClick={() => initiatePasswordCheck('p1')} className="px-3 bg-indigo-100 text-indigo-500 rounded-xl hover:bg-indigo-200" title="查看内容"><Eye size={20}/></button>
                                        </>
                                    )}
                                </div>
                                {/* P1 密码设置区域 */}
                                {editingPwdPlayer === 'p1' && !p1Masked && (
                                    <div className="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200 animate-in slide-in-from-top-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-gray-500 whitespace-nowrap">解锁密码:</span>
                                            <input 
                                                type="password" 
                                                value={p1Password}
                                                onChange={(e) => setP1Password(e.target.value)}
                                                className="flex-1 px-2 py-1 bg-white border border-gray-300 rounded text-sm"
                                                placeholder="默认 123456"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* P2 输入区 */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-sky-500 uppercase tracking-wider ml-1">
                                    {p2Name || 'P2 蓝方'} 赢了想要...
                                </label>
                                <div className="flex gap-2 relative">
                                    {!p2Masked ? (
                                        <>
                                            <div className="relative flex-1">
                                                <input 
                                                    type={p2InputType}
                                                    autoComplete="off"
                                                    value={p2Reward}
                                                    onChange={(e) => setP2Reward(e.target.value)}
                                                    placeholder="例: 请喝大杯奶茶" 
                                                    className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-sky-50 border-2 border-sky-100 rounded-xl focus:outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100 transition-all text-gray-700 font-medium placeholder:text-sky-300/70"
                                                />
                                                <button 
                                                    onClick={() => toggleInputType('p2')}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-sky-400/60 hover:text-sky-500 transition-colors p-1"
                                                    title={p2InputType === 'text' ? '隐藏内容(密文)' : '显示内容(明文)'}
                                                >
                                                    {p2InputType === 'text' ? <EyeOff size={16}/> : <Eye size={16}/>}
                                                </button>
                                            </div>
                                            <button onClick={() => lockReward('p2')} className="px-2 sm:px-3 bg-sky-100 text-sky-500 rounded-xl hover:bg-sky-200" title="锁定并隐藏"><Lock size={18} className="sm:w-5 sm:h-5"/></button>
                                            <button onClick={() => handleRandomReward('p2')} className="px-2 sm:px-3 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200" title={`随机生成 (${CATEGORY_LABELS[rewardCategory]})`}><Dices size={18} className="sm:w-5 sm:h-5"/></button>
                                            <button onClick={() => togglePwdSetting('p2')} className={`px-2 sm:px-3 rounded-xl hover:bg-gray-200 transition-colors ${editingPwdPlayer==='p2' ? 'bg-gray-200 text-gray-800' : 'bg-gray-100 text-gray-500'}`} title="设置密码"><KeyRound size={18} className="sm:w-5 sm:h-5"/></button>
                                        </>
                                    ) : (
                                        <>
                                            <div 
                                                onClick={() => clearAndUnlock('p2')}
                                                className="flex-1 px-3 sm:px-4 py-2 sm:py-3 bg-sky-100 border-2 border-sky-200 rounded-xl text-sky-400 font-black tracking-widest cursor-pointer hover:bg-sky-200 flex items-center justify-between"
                                            >
                                                <span>******</span>
                                                <span className="text-[10px] font-normal opacity-70">点击清空重填</span>
                                            </div>
                                            <button onClick={() => initiatePasswordCheck('p2')} className="px-3 bg-indigo-100 text-indigo-500 rounded-xl hover:bg-indigo-200" title="查看内容"><Eye size={20}/></button>
                                        </>
                                    )}
                                </div>
                                {/* P2 密码设置区域 */}
                                {editingPwdPlayer === 'p2' && !p2Masked && (
                                    <div className="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200 animate-in slide-in-from-top-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs text-gray-500 whitespace-nowrap">解锁密码:</span>
                                            <input 
                                                type="password" 
                                                value={p2Password}
                                                onChange={(e) => setP2Password(e.target.value)}
                                                className="flex-1 px-2 py-1 bg-white border border-gray-300 rounded text-sm"
                                                placeholder="默认 123456"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 查看密码后的内容展示 */}
                        {viewedRewardContent && (
                            <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-center animate-in zoom-in shrink-0">
                                <div className="text-xs text-yellow-600 font-bold mb-1">已解密内容</div>
                                <div className="text-lg font-black text-gray-800">{viewedRewardContent}</div>
                            </div>
                        )}

                        <button 
                            onClick={launchGame}
                            className={`w-full py-3 sm:py-4 text-white rounded-2xl font-bold text-lg shadow-xl shadow-gray-200 transition-all active:scale-95 flex items-center justify-center gap-2 shrink-0
                                ${gameMode === 'INFINITE' ? 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700' : 'bg-gray-900 hover:bg-black'}`}
                        >
                            {(!p1Reward && !p2Reward && gameMode !== 'INFINITE') ? '跳过并开始' : '开始对决'} <Play size={18} fill="currentColor"/>
                        </button>
                    </div>

                    {/* 密码验证弹窗 (嵌套在彩头弹窗之上) */}
                    {passwordCheckState.visible && (
                        <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-10 flex flex-col items-center justify-center p-6 rounded-3xl animate-in fade-in">
                            <h3 className="text-lg font-bold text-gray-800 mb-4">输入解锁密码</h3>
                            <input 
                                type="password" 
                                autoFocus
                                value={passwordCheckState.input}
                                onChange={(e) => setPasswordCheckState(prev => ({...prev, input: e.target.value}))}
                                className="w-full max-w-[200px] text-center text-2xl tracking-widest px-4 py-3 bg-gray-100 rounded-xl border-2 border-transparent focus:border-indigo-500 focus:bg-white transition-all outline-none mb-4"
                                placeholder="******"
                            />
                            <div className="flex gap-3 w-full max-w-[200px]">
                                <button onClick={() => setPasswordCheckState(prev => ({...prev, visible: false}))} className="flex-1 py-2 bg-gray-200 rounded-lg font-bold text-gray-600">取消</button>
                                <button onClick={verifyPassword} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg font-bold">确认</button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 无限模式结算汇总弹窗 */}
            {showInfiniteSummary && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-md scale-100 animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                                <Infinity className="text-purple-600" /> 无限世界战报
                            </h2>
                            <button onClick={() => switchGameMode('TOUCH')} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200">
                                <XCircle className="text-gray-500"/>
                            </button>
                        </div>

                        <div className="flex gap-4 mb-6">
                            <div className="flex-1 bg-rose-50 border border-rose-100 rounded-xl p-3 text-center">
                                <div className="text-xs text-rose-400 font-bold mb-1">{p1Name || '红方'}胜场</div>
                                <div className="text-3xl font-black text-rose-600">{infiniteStats.filter(r => r.winner === 'p1').length}</div>
                            </div>
                            <div className="flex-1 bg-sky-50 border border-sky-100 rounded-xl p-3 text-center">
                                <div className="text-xs text-sky-400 font-bold mb-1">{p2Name || '蓝方'}胜场</div>
                                <div className="text-3xl font-black text-sky-600">{infiniteStats.filter(r => r.winner === 'p2').length}</div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2 space-y-2 mb-4">
                            {infiniteStats.map((round) => (
                                <div key={round.roundNumber} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                                    <div className="font-mono text-xs font-bold text-gray-400 w-6">#{round.roundNumber}</div>
                                    <div className={`font-bold ${round.winner === 'p1' ? 'text-rose-500' : 'text-sky-500'}`}>
                                        {round.winner === 'p1' ? (p1Name || '红方') : (p2Name || '蓝方')}
                                    </div>
                                    <div className="flex-1 text-right text-sm font-medium text-gray-600 truncate">
                                        赢走: {round.reward}
                                    </div>
                                </div>
                            ))}
                            {infiniteStats.length === 0 && <div className="text-center text-gray-400 py-8">暂无对战记录</div>}
                        </div>

                        <div className="flex gap-2 w-full mt-auto">
                            <button 
                                onClick={generateBattleReport}
                                disabled={isGeneratingReport}
                                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isGeneratingReport ? <Loader2 size={18} className="animate-spin"/> : <FileImage size={18}/>} 
                                {isGeneratingReport ? '生成中...' : '生成总战报'}
                            </button>
                            <button 
                                onClick={() => switchGameMode('TOUCH')}
                                className="flex-1 py-3 bg-gray-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-black transition-colors"
                            >
                                <LogOut size={18}/> 退出
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* 战报模态框 (显示生成的图片) */}
            {showReportModal && (
                <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-300" onClick={() => setShowReportModal(false)}>
                    <div className="relative max-w-sm w-full" onClick={e => e.stopPropagation()}>
                        <div className="bg-white p-2 rounded-2xl shadow-2xl overflow-hidden">
                            {reportImageUrl ? (
                                <img src={reportImageUrl} alt="Battle Report" className="w-full h-auto rounded-xl block" />
                            ) : (
                                <div className="h-64 flex items-center justify-center text-gray-400">图片生成中...</div>
                            )}
                        </div>
                        <div className="mt-4 flex justify-center gap-4">
                            <button 
                                onClick={() => setShowReportModal(false)}
                                className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors backdrop-blur-md"
                            >
                                <XCircle size={24} />
                            </button>
                            {reportImageUrl && (
                                <a 
                                    href={reportImageUrl} 
                                    download={`ReadyGoDuel_Report_${Date.now()}.png`}
                                    className="px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-full font-bold flex items-center gap-2 shadow-lg transition-all active:scale-95"
                                >
                                    <Download size={20}/> 保存图片
                                </a>
                            )}
                        </div>
                        <p className="text-white/50 text-center text-sm mt-4">长按图片可保存到相册</p>
                    </div>
                </div>
            )}

            {/* IDLE 状态引导页 */}
            {gameState === 'IDLE' && !isReplaying && !showRewardInput && (
                <div className="absolute inset-0 z-30 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center animate-fade-in">
                    <div className="mb-8">
                        {customTitle ? (
                             <>
                                <h1 className="text-3xl sm:text-4xl font-black text-indigo-600 mb-2 tracking-tight break-words max-w-md mx-auto">
                                    {customTitle}
                                </h1>
                                <p className="text-gray-400 text-sm font-bold uppercase tracking-widest mb-4">
                                    {gameMode === 'VOICE' ? '声控模式' : (gameMode === 'INFINITE' ? '无限模式' : '触摸模式')}
                                </p>
                             </>
                        ) : (
                            <h1 className="text-3xl sm:text-4xl font-black text-gray-800 mb-4 tracking-tight">
                                {gameMode === 'VOICE' ? '谁先发声谁赢' : (gameMode === 'INFINITE' ? '无限世界挑战' : '双人反应对决')}
                            </h1>
                        )}
                        
                        <p className="text-gray-500 max-w-xs mx-auto text-sm sm:text-base leading-relaxed">
                            {gameMode === 'VOICE' && <>看到 <strong className="text-rose-500">GO</strong> 信号时，立即喊出声音。</>}
                            {gameMode === 'TOUCH' && <>看到 <strong className="text-indigo-500">GO</strong> 信号时，立即点击屏幕。</>}
                            {gameMode === 'INFINITE' && <>连续对决模式！<br/>每一轮结束后自动生成新的随机彩头，直到一方退出。</>}
                        </p>
                    </div>

                    {gameMode === 'VOICE' && (
                        <div className="mb-10 w-full max-w-xs bg-gray-50 p-4 rounded-2xl border border-gray-200 shadow-sm">
                            <div className="flex justify-between items-center mb-2 text-xs font-bold text-gray-500">
                                <span className="flex items-center gap-1"><BarChart3 size={12}/> 麦克风预检</span>
                                <span className={isMicInitialized ? "text-green-500" : "text-gray-400"}>{isMicInitialized ? "工作中" : "未启动"}</span>
                            </div>
                            <div className="h-3 bg-gray-200 rounded-full overflow-hidden relative">
                                <div className="absolute left-0 top-0 bottom-0 bg-green-500 transition-all duration-75" style={{ width: `${Math.min(currentVolume * 100, 100)}%` }}></div>
                                <div className="absolute top-0 bottom-0 w-0.5 bg-red-400 left-[2%] z-10"></div> 
                            </div>
                            <div className="mt-4 flex gap-2">
                                {!isMicInitialized ? (
                                    <button onClick={initAudioEngine} className="flex-1 py-2.5 bg-gray-900 text-white text-xs font-bold rounded-lg hover:bg-black transition-colors shadow-lg shadow-gray-200">启动麦克风</button>
                                ) : (
                                    <>
                                        <button onClick={() => initAudioEngine()} className="flex-1 py-2 bg-white border border-gray-200 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-50 flex items-center justify-center gap-1"><RefreshCw size={10}/> 重置</button>
                                        <button onClick={() => safePlaySound('test', 'VOICE')} className="flex-1 py-2 bg-white border border-gray-200 text-gray-600 text-xs font-bold rounded-lg hover:bg-gray-50 flex items-center justify-center gap-1"><Music size={10}/> 试听</button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    <button 
                        onClick={handleStartClick} 
                        className={`w-full max-w-xs py-4 text-white text-xl font-black rounded-2xl shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-3
                            ${gameMode === 'VOICE' ? 'bg-gradient-to-r from-rose-500 to-pink-600' : (gameMode === 'INFINITE' ? 'bg-gradient-to-r from-purple-600 to-indigo-600' : 'bg-gradient-to-r from-indigo-600 to-violet-600')}`}
                    >
                        <Play size={28} fill="currentColor" /> {gameMode === 'INFINITE' ? '开启挑战' : '立即开始'}
                    </button>
                </div>
            )}

            <div className="flex-1 flex flex-col md:flex-row relative">
                {gameState !== 'IDLE' && (
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none flex flex-col items-center justify-center">

                        {gameState === 'WAITING' && (
                            <div className="bg-white p-2 rounded-full shadow-lg border-4 border-gray-100 relative">
                                {gameMode === 'VOICE' && <div className="absolute inset-0 rounded-full bg-rose-400 opacity-30 transition-transform duration-75 ease-out" style={{ transform: `scale(${1 + currentVolume})` }}></div>}
                                <div className="relative w-16 h-16 md:w-24 md:h-24 rounded-full bg-orange-500 flex items-center justify-center text-white font-black text-xl md:text-2xl shadow-inner z-10">
                                    {gameMode === 'VOICE' ? <MicOff size={32}/> : '...'}
                                </div>
                                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-orange-100 text-orange-600 text-xs px-2 py-1 rounded font-bold">{gameMode === 'VOICE' ? '保持安静...' : '等待信号'}</div>
                            </div>
                        )}
                        {gameState === 'GO' && (
                            <div className="animate-bounce">
                                <div className={`w-24 h-24 md:w-32 md:h-32 rounded-full flex items-center justify-center text-white font-black text-3xl md:text-5xl shadow-2xl ring-8 ${gameMode === 'VOICE' ? 'bg-rose-500 ring-rose-200' : 'bg-green-500 ring-green-200'}`}>{gameMode === 'VOICE' ? '喊!' : 'GO!'}</div>
                            </div>
                        )}
                        {gameState === 'ENDED' && (
                            // 动态 class：回放时去除白色背景和阴影
                            <div className={`flex flex-col items-center ${isReplaying ? '' : 'bg-white p-4 rounded-2xl shadow-2xl border border-gray-100'} animate-pop-in pointer-events-auto`}>
                                {!isReplaying && (
                                    <>
                                        <div className={`text-2xl md:text-3xl font-black mb-1 ${winner === 'p1' ? 'text-rose-600' : 'text-sky-600'}`}>
                                            {winner === 'p1' ? (p1Name || '红方') + '胜' : (p2Name || '蓝方') + '胜'}
                                        </div>
                                        {winReason === 'REACTION' && <div className="text-xl font-mono font-bold text-gray-700 bg-gray-100 px-3 py-1 rounded-lg">{reactionTime} ms</div>}
                                        {detectedFreq > 0 && gameMode === 'VOICE' && <div className="text-xs text-gray-400 mt-1">检测频率: {detectedFreq}Hz</div>}
                                        {winReason === 'FALSE_START' && <div className="text-red-500 font-bold text-sm">对方抢跑犯规</div>}

                                        {/* 揭晓彩头区域 */}
                                        {((winner === 'p1' && p1Reward) || (winner === 'p2' && p2Reward)) && (gameMode === 'TOUCH' || gameMode === 'INFINITE' || winReason !== 'FALSE_START') && (
                                            <div 
                                                onClick={() => setIsRewardRevealed(true)}
                                                className={`mt-4 w-full max-w-[200px] cursor-pointer transition-all duration-500 preserve-3d group perspective-1000 ${isRewardRevealed ? '' : 'hover:scale-105'}`}
                                            >
                                                {!isRewardRevealed ? (
                                                    <div className="bg-gradient-to-r from-yellow-400 to-orange-400 p-0.5 rounded-xl shadow-lg">
                                                        <div className="bg-white rounded-[10px] py-2 px-3 flex items-center justify-center gap-2">
                                                            <div className="bg-yellow-100 p-1.5 rounded-full text-yellow-600">
                                                                <Lock size={14} />
                                                            </div>
                                                            <span className="text-sm font-bold text-gray-600">点击揭晓彩头</span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl py-3 px-4 text-center animate-in zoom-in duration-300">
                                                        <div className="text-[10px] font-bold text-yellow-600 uppercase tracking-widest mb-1 flex items-center justify-center gap-1">
                                                            <Sparkles size={10}/> 赢家奖励 <Sparkles size={10}/>
                                                        </div>
                                                        <div className="text-lg font-black text-gray-800 break-words leading-tight">
                                                            {winner === 'p1' ? p1Reward : p2Reward}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        
                                        {/* 控制按钮组 */}
                                        <div className="flex gap-2 mt-4 w-full justify-center">
                                            <button 
                                                onClick={generateBattleReport}
                                                disabled={isGeneratingReport} 
                                                className={`flex-1 max-w-[120px] py-2 px-3 bg-white border border-gray-200 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-50 flex items-center justify-center gap-1 shadow-sm ${isGeneratingReport ? 'opacity-50 cursor-not-allowed' : ''}`} 
                                            >
                                                {isGeneratingReport ? <Loader2 size={14} className="animate-spin"/> : <FileImage size={14}/>} 
                                                战报
                                            </button>

                                            {gameMode === 'INFINITE' && !isReplaying ? (
                                                <>
                                                    <button onClick={handleExitInfinite} className="flex-1 py-2 px-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 flex items-center justify-center gap-1">
                                                        <LogOut size={14}/> 退出
                                                    </button>
                                                    <button onClick={handleNextRound} className="flex-1 py-2 px-3 bg-purple-600 text-white rounded-xl font-bold text-sm shadow-lg hover:bg-purple-700 flex items-center justify-center gap-1">
                                                        <RefreshCw size={14}/> 下一轮
                                                    </button>
                                                </>
                                            ) : (
                                                !isReplaying && gameHistory.length > 0 && !isSavingAudio && gameMode === 'VOICE' && (
                                                    <button onClick={startReplay} className={`flex-1 max-w-[140px] flex items-center justify-center gap-2 px-4 py-2 backdrop-blur border text-white rounded-xl text-sm font-bold shadow-lg active:scale-95 transition-all bg-rose-500/90 border-rose-400 hover:bg-rose-600`}>
                                                        <Volume2 size={16} /> 高光时刻
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </>
                                )}
                                
                                {isReplaying ? (
                                    <AudioVisualizer 
                                        analyser={replayAnalyserRef.current} 
                                        color={winner === 'p1' ? '#f43f5e' : (winner === 'p2' ? '#0ea5e9' : '#fbbf24')} 
                                    />
                                ) : (
                                    gameMode === 'VOICE' && lastRecordingSize > 0 && <div className="mt-3 text-[10px] text-gray-400 border border-gray-200 rounded px-1">录音: {(lastRecordingSize/1024).toFixed(1)} KB</div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <PlayerZone 
                    id="p1" 
                    defaultLabel="P1 红方"
                    currentName={p1Name}
                    subLabel="高音区" 
                    keyLabel="键盘 'A'" 
                    colorClass="bg-rose-50" 
                    hasReward={!!p1Reward} 
                />
                <div className="absolute inset-0 pointer-events-none z-10 flex md:flex-row flex-col"><div className="md:w-1/2 w-full h-1/2 md:h-full border-b md:border-b-0 md:border-r border-gray-200/50"></div></div>
                <PlayerZone
                    id="p2" 
                    defaultLabel="P2 蓝方"
                    currentName={p2Name}
                    subLabel="低音区" 
                    keyLabel="键盘 'L'" 
                    colorClass="bg-sky-50" 
                    hasReward={!!p2Reward} 
                />
                
                {gameState === 'ENDED' && !isReplaying && gameHistory.length > 0 && !isSavingAudio && gameMode === 'VOICE' && (
                    <></>
                )}
            </div>

            {/* 新增：访问量统计挂件 + 上传功能 (右下角悬浮) */}
            <div className="fixed bottom-3 right-3 z-50 flex items-center gap-2 px-3 py-1.5 bg-white/80 backdrop-blur-md border border-gray-100/50 rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.08)] animate-in fade-in slide-in-from-bottom-4 duration-1000">
                
                {/* 上传自定义彩头按钮 */}
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-600 transition-colors focus:outline-none group"
                    title="上传自定义彩头(.txt)"
                >
                    <Upload size={14} className="group-hover:scale-110 transition-transform"/>
                    <span className="font-bold">DIY</span>
                </button>
                <input 
                    ref={fileInputRef}
                    type="file" 
                    hidden 
                    accept=".txt" 
                    onChange={handleFileUpload}
                />

                <div className="w-px h-3 bg-gray-300 mx-1"></div>

                {/* 访问量显示 */}
                <div className="flex items-center gap-1.5 pointer-events-none">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </span>
                    <span className="font-bold tracking-wider text-xs text-gray-500 font-mono">PV</span>
                </div>
                <div className="w-px h-3 bg-gray-200"></div>
                <span className="font-medium min-w-[20px] text-center text-xs text-gray-400 font-mono pointer-events-none">
                    {visitCount > 0 ? visitCount.toLocaleString() : '-'}
                </span>
            </div>
        </div>
    );
}

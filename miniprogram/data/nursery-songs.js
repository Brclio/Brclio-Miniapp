'use strict';

// Snapshot of Erge-Duoduo; audio remains hosted remotely and is never bundled.
const SOURCE = Object.freeze({
  repository: 'https://github.com/Brclio/Erge-Duoduo',
  commit: '7de01bfb01e4893bff1299701861bf124f20957c',
  metadataFile: '歌曲清单.csv',
  metadataBlobSha: '195a7be165fc503dce6d1dee24a7f11875175aac',
  origin: 'https://erge-duoduo.bornforthis.cn',
  checkedOn: '2026-10-23',
  availableCount: 47,
  unavailableCount: 3
});

// Scene labels are editorial groupings; the source does not classify songs.
const SCENES = Object.freeze([
  Object.freeze({ id: 'active', title: '蹦跳儿歌' }),
  Object.freeze({ id: 'sleep', title: '睡前轻听' })
]);

const records = [
  {
    "id": "1451390672",
    "order": 1,
    "title": "小白兔白又白",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 172.783,
    "filename": "01 - 小白兔白又白 - 儿歌多多.mp3",
    "bytes": 6914133,
    "sha256": "c6b16d274f3865e6bfd497e804a56bb64fadca3c1427add7393f143479599aa7",
    "blobSha": "4eb9ca9bc33e74e387e6b0232363a9f499a6afde"
  },
  {
    "id": "2079653665",
    "order": 2,
    "title": "鲨鱼宝宝",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 121.62,
    "filename": "02 - 鲨鱼宝宝 - 儿歌多多.mp3",
    "bytes": 4867245,
    "sha256": "0fd7f29485a2a6ef49baa564988d6d1b1020ceb002ee4248793945ca973a3b36",
    "blobSha": "ffc541471837bbfe4c84f4713adb569c022ac854"
  },
  {
    "id": "2114146440",
    "order": 4,
    "title": "蓝精灵",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 124.043,
    "filename": "04 - 蓝精灵 - 儿歌多多.mp3",
    "bytes": 4964205,
    "sha256": "a1bafbb4688537db31c50a6d9fb65670c96d5b52f38a419ca82edc93be074068",
    "blobSha": "4388c6e9be763e59babc6c057d4bc6ebb0f04765"
  },
  {
    "id": "1451396976",
    "order": 5,
    "title": "小星星",
    "artist": "儿歌多多",
    "scene": "sleep",
    "duration": 74.226,
    "filename": "05 - 小星星 - 儿歌多多.mp3",
    "bytes": 2971733,
    "sha256": "3579444359d09bc6050a00a7b53c8ff459de0de39bf52e191618868a8b8bdf90",
    "blobSha": "39bf420188f66736018dc12827d6097a40e442b2"
  },
  {
    "id": "1451396951",
    "order": 6,
    "title": "我上幼儿园",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 140.207,
    "filename": "06 - 我上幼儿园 - 儿歌多多.mp3",
    "bytes": 5611146,
    "sha256": "fc4177c8667c61fbb4102657aa55874b6066254ea6693a24beb670f258559db6",
    "blobSha": "f0d416256aea456d716113a59d69de8c6520784a"
  },
  {
    "id": "2081793139",
    "order": 7,
    "title": "小老鼠上灯台",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 64.231,
    "filename": "07 - 小老鼠上灯台 - 儿歌多多.mp3",
    "bytes": 2571885,
    "sha256": "f2871085df58a77b984dfcc1dcb316257b880c8511d46ce1eea2aa4a362d52d8",
    "blobSha": "248590e887ea85e65a3dec9f3be4f4e3bb0b4915"
  },
  {
    "id": "2082153088",
    "order": 8,
    "title": "ABC字母歌",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 67.836,
    "filename": "08 - ABC字母歌 - 儿歌多多.mp3",
    "bytes": 2715733,
    "sha256": "f191b21b7d8a7c2af71bebb51665adf948204662e0082e25374be8b64c767ef7",
    "blobSha": "54b34cc2e54207588110d4cd18dae2270b3f9494"
  },
  {
    "id": "2079651205",
    "order": 9,
    "title": "公交车的轮子转呀转",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 132.277,
    "filename": "09 - 公交车的轮子转呀转 - 儿歌多多.mp3",
    "bytes": 5293485,
    "sha256": "089ebd56f2db377edc65d28636cbed3a728704bab741dcbccec572c06a054e1b",
    "blobSha": "74c355bcf8f544453ce85670f62a87ee7115b8e3"
  },
  {
    "id": "2081793137",
    "order": 10,
    "title": "数鸭子",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 106.231,
    "filename": "10 - 数鸭子 - 儿歌多多.mp3",
    "bytes": 4251885,
    "sha256": "82577d360d35d27d29b90eaf71b4105ef8cebb44b410275ae868687209f67fd6",
    "blobSha": "ff40856a0c6e664e409fa63264ebd3c4b9a2e14a"
  },
  {
    "id": "1451401281",
    "order": 11,
    "title": "打电话",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 155.605,
    "filename": "11 - 打电话 - 儿歌多多.mp3",
    "bytes": 6226591,
    "sha256": "2acc2f76554f0f39be0de6228beb3fa29542f2fab334c9f1d21a7c8726984d2f",
    "blobSha": "75ebaf6ef12ad9aeb759a1287032ba8b271b6986"
  },
  {
    "id": "2096688937",
    "order": 12,
    "title": "小手拍拍",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 121.355,
    "filename": "12 - 小手拍拍 - 儿歌多多.mp3",
    "bytes": 4856685,
    "sha256": "fb5f50524d1afbb18c030a3eac81dd00816b51a18c30577cb21663098477bf93",
    "blobSha": "0f5d85d3fa977e85248f9a49f97182a192863a9f"
  },
  {
    "id": "1451392059",
    "order": 13,
    "title": "两只老虎",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 127.488,
    "filename": "13 - 两只老虎 - 儿歌多多.mp3",
    "bytes": 5102280,
    "sha256": "f4505c6a97a888f8349542400b443b82e9918ef4cd4b54cd5793024233b9be35",
    "blobSha": "f5c5980fb0c6d1fbbd7fa25f53c06928cab8932f"
  },
  {
    "id": "3358694566",
    "order": 14,
    "title": "虫儿飞（哄睡版）",
    "artist": "儿歌多多",
    "scene": "sleep",
    "duration": 190.523,
    "filename": "14 - 虫儿飞（哄睡版） - 儿歌多多.mp3",
    "bytes": 7623405,
    "sha256": "2b6983e9135567befcb4a0f4d98ae42a819a5cbd43e18220c21aec701ff9541d",
    "blobSha": "eb92430d08305e9458c0e59fda3443de5ca4dc10"
  },
  {
    "id": "2081793138",
    "order": 15,
    "title": "白龙马",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 117.618,
    "filename": "15 - 白龙马 - 儿歌多多.mp3",
    "bytes": 4706925,
    "sha256": "aa888e13a1369a48c2b04b8a68f3fc166d6c5e9efb5c75b95b77b2a6055c5edd",
    "blobSha": "b8e534cd6d7e023b517508a7fc3598a00ae6eede"
  },
  {
    "id": "2081794945",
    "order": 16,
    "title": "三只小猫",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 90.215,
    "filename": "16 - 三只小猫 - 儿歌多多.mp3",
    "bytes": 3610605,
    "sha256": "e600e1a21d8efa82cc81a707386c0d593d63c2d51b9825ea4f295e0b683355d1",
    "blobSha": "ee8caad0e367471b34d700b5817a07fe7fa14808"
  },
  {
    "id": "2081793136",
    "order": 17,
    "title": "拔萝卜",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 100.017,
    "filename": "17 - 拔萝卜 - 儿歌多多.mp3",
    "bytes": 4003245,
    "sha256": "21c736f14a114b16dac80d77854f78a1b18fbb7373bd88f91d33c37b939e967c",
    "blobSha": "331ef02ac52f4d0a1da98a1a6754183683c9a5a6"
  },
  {
    "id": "2081794946",
    "order": 18,
    "title": "我爱洗澡",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 113.53,
    "filename": "18 - 我爱洗澡 - 儿歌多多.mp3",
    "bytes": 4543725,
    "sha256": "0cbe4d22d8b3481be5934dbe142291b5326c5f5c3bd07d0adba8db22bf59560c",
    "blobSha": "e701fe18585f80f9e53da3f2eb85c2a324269682"
  },
  {
    "id": "2082151352",
    "order": 19,
    "title": "生日快乐歌",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 75.651,
    "filename": "19 - 生日快乐歌 - 儿歌多多.mp3",
    "bytes": 3028158,
    "sha256": "44152183cac71601468e8be6e211cf9e79e658de1036c39b723f75f0e3ac9949",
    "blobSha": "3053b4551f84443eac4a66266d5112d7aa3695fe"
  },
  {
    "id": "2112543522",
    "order": 20,
    "title": "小兔子乖乖+一分钱+小红帽+白龙马+粉刷匠+找朋友 (DJ串烧)",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 220.645,
    "filename": "20 - 小兔子乖乖+一分钱+小红帽+白龙马+粉刷匠+找朋友 (DJ串烧) - 儿歌多多.mp3",
    "bytes": 8828387,
    "sha256": "fb9b24cc2cb0dc99bfa5dc2ac8c8f199a7bd94352aa99e952005c9f4c28ed540",
    "blobSha": "cbf57f1ec81b091bcbe874c7289dd9dc2cd6700a"
  },
  {
    "id": "1451396964",
    "order": 21,
    "title": "蜗牛与黄鹂鸟",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 155.989,
    "filename": "21 - 蜗牛与黄鹂鸟 - 儿歌多多.mp3",
    "bytes": 6242264,
    "sha256": "b3925dde27d20e58466d688facad312b43f4bc22104b58d54baa10b24d2ac13b",
    "blobSha": "c034917102c97d21cd1b0b275e531dddbf15a176"
  },
  {
    "id": "1451401318",
    "order": 22,
    "title": "粉刷匠",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 150.28,
    "filename": "22 - 粉刷匠 - 儿歌多多.mp3",
    "bytes": 6013431,
    "sha256": "37a848e1fa0223b6594980442f10f16424316899a037939995fc3cc6eac143b3",
    "blobSha": "1970ffe266e39e4624b3c9f8e4101b38f0d460d8"
  },
  {
    "id": "2603145485",
    "order": 23,
    "title": "唐僧骑马",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 136.349,
    "filename": "23 - 唐僧骑马 - 儿歌多多.mp3",
    "bytes": 5456685,
    "sha256": "a139148f8ab5824fdae23695909a4d94f2eb8a222c47f588778590ab7fb62091",
    "blobSha": "fa38d800c72a57d5af824192546c8596030aedd6"
  },
  {
    "id": "2106776540",
    "order": 24,
    "title": "小蝌蚪找妈妈",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 104,
    "filename": "24 - 小蝌蚪找妈妈 - 儿歌多多.mp3",
    "bytes": 4162605,
    "sha256": "28694bc5359a28a7e943e7be9436c89d617b9b3783291c6f59b37299828b06ae",
    "blobSha": "517bf74463054ce4881af1fda16dd0ebba9d1cd6"
  },
  {
    "id": "1451390674",
    "order": 25,
    "title": "小毛驴",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 156.395,
    "filename": "25 - 小毛驴 - 儿歌多多.mp3",
    "bytes": 6257938,
    "sha256": "e2dfb87dcf819f3ee9d52a3586cc9161f9044318c0e7a4f7ae1219d3145e19dc",
    "blobSha": "4accbc5523912c7585a3428764d9d28e3f48b776"
  },
  {
    "id": "1451401320",
    "order": 26,
    "title": "世上只有妈妈好",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 145.14,
    "filename": "26 - 世上只有妈妈好 - 儿歌多多.mp3",
    "bytes": 5808631,
    "sha256": "f6e0465bdca1467fd18c9f2973d15b6902207849097c6bd17b46427f062273d5",
    "blobSha": "bdaf74bcc63176c258433c4b82a2da4e8a56522f"
  },
  {
    "id": "2109730790",
    "order": 27,
    "title": "两只老虎+蜗牛与黄鹂鸟+捉泥鳅+挖掘机+小白兔白又白+小毛驴+采蘑菇的小姑娘（DJ串烧）",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 226.875,
    "filename": "27 - 两只老虎+蜗牛与黄鹂鸟+捉泥鳅+挖掘机+小白兔白又白+小毛驴+采蘑菇的小姑娘（DJ串烧） - 儿歌多多.mp3",
    "bytes": 9078117,
    "sha256": "0d9500a3d45d72ff986f1051dd5747d1634b7f5b03f66843811bc77f3e614ea5",
    "blobSha": "34b5623cde2ee25d0b751f9f88006a44e067446e"
  },
  {
    "id": "2082153080",
    "order": 28,
    "title": "一只哈巴狗",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 129.378,
    "filename": "28 - 一只哈巴狗 - 儿歌多多.mp3",
    "bytes": 5177513,
    "sha256": "cc67c6b352193a3508e47e3bf5586cffc4097af2082d7b95fe2a6401afdc4ba0",
    "blobSha": "e894fd99cc4d782402cc303fc56b619772b2a773"
  },
  {
    "id": "1451397019",
    "order": 29,
    "title": "采蘑菇的小姑娘",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 158.411,
    "filename": "29 - 采蘑菇的小姑娘 - 儿歌多多.mp3",
    "bytes": 6339440,
    "sha256": "d6c019793826102a9933f5b63ab07750ee816ca74debcafd747a69b3d74cab31",
    "blobSha": "5885f48edff6adf7b76caa79e063cc27c1635474"
  },
  {
    "id": "1451392075",
    "order": 30,
    "title": "一分钱",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 128.32,
    "filename": "30 - 一分钱 - 儿歌多多.mp3",
    "bytes": 5135717,
    "sha256": "91be76b25f2c10e2aa184518f2220d5d3b14221ed902706ea08571f42e9abab4",
    "blobSha": "0761330218692d29a1cc834a46f8faf411756423"
  },
  {
    "id": "2082151355",
    "order": 31,
    "title": "好爸爸坏爸爸",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 152.471,
    "filename": "31 - 好爸爸坏爸爸 - 儿歌多多.mp3",
    "bytes": 6101203,
    "sha256": "3e01ad0bf7e8e9940391253d93b66666f23dce4c66bbd936bc26f5ec83d98149",
    "blobSha": "a69ed141cc6a319aed0f09e320c4536152d81304"
  },
  {
    "id": "2082151367",
    "order": 32,
    "title": "王老先生有块地",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 73.824,
    "filename": "32 - 王老先生有块地 - 儿歌多多.mp3",
    "bytes": 2954925,
    "sha256": "a599a0360195ab34be0c824f7d2530a2148142b539f3fe6f9689a66078fa39e9",
    "blobSha": "e084db23d856ca15fb1dba1538b93fb03d1052ac"
  },
  {
    "id": "2081794947",
    "order": 33,
    "title": "拍手歌",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 88.38,
    "filename": "33 - 拍手歌 - 儿歌多多.mp3",
    "bytes": 3537645,
    "sha256": "cece06b849abb693398698dba90ec067eaa4f10e0768ceb1cb52abc9433568ec",
    "blobSha": "790198866daad1ffc86ea5cdd290f8c8c08677ce"
  },
  {
    "id": "2082151359",
    "order": 34,
    "title": "卖汤圆",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 86.686,
    "filename": "34 - 卖汤圆 - 儿歌多多.mp3",
    "bytes": 3470150,
    "sha256": "1890b5a545a1a9325bfb3d0a442645c14fd3bcdb2c1159eaabebbaa69750ceb6",
    "blobSha": "fd88df35b6c7f139f50288c362b2c854bb0fa65d"
  },
  {
    "id": "2165430883",
    "order": 35,
    "title": "送别",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 134.983,
    "filename": "35 - 送别 - 儿歌多多.mp3",
    "bytes": 5401965,
    "sha256": "11d47c6dc25ea3508993564bd444a697bc0a6d03dace2b3e28d8961965fc4382",
    "blobSha": "0a5405cf2d0a8a1a0948fedce258912f8249ff32"
  },
  {
    "id": "2082153081",
    "order": 36,
    "title": "小宝贝快快睡",
    "artist": "儿歌多多",
    "scene": "sleep",
    "duration": 121.22,
    "filename": "36 - 小宝贝快快睡 - 儿歌多多.mp3",
    "bytes": 4851505,
    "sha256": "5ca44ce82f1da8534904cd0fb46c29eb1e8c4ba7a6b24ab48a35aa79ecfa16a0",
    "blobSha": "c1bdbd381e82dad7722225140a5e95b1bcdc2549"
  },
  {
    "id": "2082151356",
    "order": 37,
    "title": "小二郎上学堂（读书郎）",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 63.064,
    "filename": "37 - 小二郎上学堂（读书郎） - 儿歌多多.mp3",
    "bytes": 2525562,
    "sha256": "911c075364f50d5954bc4afa6a83f3b5492a7913a3d126c7018f687ac9567ec7",
    "blobSha": "c785faeaa306a5a04738fd7c99637e426c5be3c0"
  },
  {
    "id": "2081793135",
    "order": 40,
    "title": "捉泥鳅",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 151.818,
    "filename": "40 - 捉泥鳅 - 儿歌多多.mp3",
    "bytes": 6074925,
    "sha256": "9035a59b7638e045b04fb91dfd5624dac7c9629d076be467389aff92fca947f7",
    "blobSha": "170a84dda4ff231078954e487f7cf845dfb37090"
  },
  {
    "id": "1451401297",
    "order": 41,
    "title": "小燕子",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 161.015,
    "filename": "41 - 小燕子 - 儿歌多多.mp3",
    "bytes": 6442885,
    "sha256": "2c484197f67793e27289f8573a6b711f37315efb0fa9d8d219d489a63c899730",
    "blobSha": "61d7dc3afba49b2d46d3cfbef6785faf015688df"
  },
  {
    "id": "3391569712",
    "order": 42,
    "title": "爱咬人的小猪猪",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 105.688,
    "filename": "42 - 爱咬人的小猪猪 - 儿歌多多.mp3",
    "bytes": 4229805,
    "sha256": "7e6dcb821d68b3237ef7b9c3c9f62267cffaa4f11c07508a648e92ea9c452317",
    "blobSha": "b5653cb4b8f03eed3e1544b21785a2716c36ba7d"
  },
  {
    "id": "2081793141",
    "order": 43,
    "title": "小红帽",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 89.631,
    "filename": "43 - 小红帽 - 儿歌多多.mp3",
    "bytes": 3587565,
    "sha256": "2e1f9e8a6cee2d3e8ca2602808c5a0de8b08211f980cfb8dbb4fc1bd406a1faf",
    "blobSha": "b0601724bfdce9c42fdd75501344d5402b061b74"
  },
  {
    "id": "3391644303",
    "order": 44,
    "title": "摇篮曲（哄睡版）",
    "artist": "儿歌多多",
    "scene": "sleep",
    "duration": 164.531,
    "filename": "44 - 摇篮曲（哄睡版） - 儿歌多多.mp3",
    "bytes": 6583725,
    "sha256": "d957b3fe97d1a4e213054d237d3afaccc19d2598f66985b2e5d7ef571c17a434",
    "blobSha": "938382dabc7329c3bcf22a01bc21f71ffda80045"
  },
  {
    "id": "2082151350",
    "order": 45,
    "title": "春天在哪里",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 89.691,
    "filename": "45 - 春天在哪里 - 儿歌多多.mp3",
    "bytes": 3590313,
    "sha256": "b48b1c2f1b1534a18e13378154b181b81ba50ea107a547a26a724851ed45bdd8",
    "blobSha": "f13c55251bbd063112a7fc8a932b3fb651e4f8eb"
  },
  {
    "id": "2098213678",
    "order": 46,
    "title": "动物叫声猜猜猜",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 121.038,
    "filename": "46 - 动物叫声猜猜猜 - 儿歌多多.mp3",
    "bytes": 4844205,
    "sha256": "e845c7326cacb344e3452006c123c80c8b4a40c54d41a76d21c35ee824650db9",
    "blobSha": "23dd68dedd1e8e0a1e4cd86f5f33e4b4ad3d2a8e"
  },
  {
    "id": "1451401289",
    "order": 47,
    "title": "丢手绢",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 137.045,
    "filename": "47 - 丢手绢 - 儿歌多多.mp3",
    "bytes": 5484713,
    "sha256": "cbd29da214008ed6ba1e25a7cea5c66395c09471220deb84d7ea94fd5f12415a",
    "blobSha": "6383641f5de33ee15d8927947fbdbf13b55c440d"
  },
  {
    "id": "3312267637",
    "order": 48,
    "title": "鳄鱼先生开火车",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 139.535,
    "filename": "48 - 鳄鱼先生开火车 - 儿歌多多.mp3",
    "bytes": 5583405,
    "sha256": "a8b76ed15ac19f533dc1661143f83c94cf87305b91548aa2f098f2b2c62b2e16",
    "blobSha": "dab08cbf31360b1f7064c75e706ba98aa986f00a"
  },
  {
    "id": "2082153078",
    "order": 49,
    "title": "上学歌",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 70.788,
    "filename": "49 - 上学歌 - 儿歌多多.mp3",
    "bytes": 2833807,
    "sha256": "9d93b94c15f7efe03667db6d4c5243a97279c936e9be6c9d24781342ff0a821b",
    "blobSha": "dbd29f60c3f5284b1b8e00359fe3489a7a3f421f"
  },
  {
    "id": "1451403039",
    "order": 50,
    "title": "新年好",
    "artist": "儿歌多多",
    "scene": "active",
    "duration": 76.845,
    "filename": "50 - 新年好 - 儿歌多多.mp3",
    "bytes": 3076223,
    "sha256": "e0fb8886297e9ad4725c3d8fdacd98438d2a96cdbdfe7a88a7da0b51bd50ff9f",
    "blobSha": "acd33ee2199b3070d48b23c88959275842e0e60d"
  }
];

const SONGS = Object.freeze(records.map(record => Object.freeze(Object.assign({}, record, {
  scenes: Object.freeze([record.scene]),
  url: SOURCE.origin + '/' + encodeURIComponent(record.filename),
  cover: '/nursery/assets/covers/' + record.id + '.jpg',
  coverUrl: 'https://pocket.bornforthis.cn/assets/nursery-covers/' + record.id + '.jpg'
}))));

function getSongById(id) {
  return SONGS.find(song => song.id === String(id)) || null;
}

module.exports = { SOURCE, SCENES, SONGS, getSongById };

const { createGameApp } = require('./lib/game-app');
createGameApp(wx, { accountSyncSupported: !!wx.accountSyncSupported });

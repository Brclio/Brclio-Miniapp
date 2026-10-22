const sync = require('./lib/account-sync');
const learning = require('./lib/lingotiles');

App({
  onLaunch() {
    // Capture existing guest history before the first account claims it.
    if (learning.prepareHistorySync) learning.prepareHistorySync();
    sync.activate({ pull: false });
    this._networkListener = event => sync.networkChanged(event);
    if (wx.onNetworkStatusChange) wx.onNetworkStatusChange(this._networkListener);
  },
  onShow() { sync.flush(); },
  onHide() { sync.onHide(); }
});

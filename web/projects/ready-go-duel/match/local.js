(function () {
  'use strict';
  // Legacy manual backup is retired. Optional account synchronization is
  // supplied by the common runtime and keeps reward/password fields local.
  window.wx.cloudBackupSupported = false;
  window.wx.accountSyncSupported = !!window.BrclioAccount;
})();

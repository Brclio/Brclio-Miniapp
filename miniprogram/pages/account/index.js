const { createAccountClient, validateDuel } = require('../../lib/account');

Page({
  data: { user: null, busy: false, tab: 'login', message: '', identifier: '', password: '', username: '', email: '', code: '', nickname: '',
    currentPassword: '', newPassword: '', confirmPassword: '', passwordEnabled: false, cooldown: 0, localCount: 0, cloudLabel: '尚未读取', cloudCount: null },
  update(value) { if (!this.closed) this.setData(value); },
  onLoad() { this.account = createAccountClient(wx); this.update({ user: this.account.currentUser() }); this.updateLocal(); },
  onShow() { if (this.account) void this.run(async () => { await this.refresh(); }); },
  onUnload() { this.closed = true; clearInterval(this.cooldownTimer); if (this.account) this.account.dispose(); },
  updateLocal() {
    try { this.update({ localCount: this.account.localSnapshot().matches.length }); }
    catch (error) { this.update({ message: error.message }); }
  },
  async refresh() {
    const value = await this.account.refresh();
    if (!this.closed) this.update({ user: value.user || null, passwordEnabled: value.passwordEnabled === true,
      nickname: value.user && value.user.nickname || '', username: value.user && value.user.username || '' });
  },
  async run(action) {
    if (this.data.busy || this.closed) return;
    this.update({ busy: true, message: '' });
    try { await action(); }
    catch (error) { if (!this.closed) this.update({ message: error.status === 409 ? (error.message + ' 本机数据已保留，请重新读取云端后预览。') : error.message || '操作未完成，请重试。' }); }
    finally { if (!this.closed) { this.update({ busy: false, user: this.account.currentUser() }); this.updateLocal(); } }
  },
  input(event) {
    const field = event.currentTarget.dataset.field;
    if (['identifier', 'password', 'username', 'email', 'code', 'nickname', 'currentPassword', 'newPassword', 'confirmPassword'].includes(field)) this.update({ [field]: event.detail.value });
  },
  switchTab(event) { if (!this.data.busy) this.update({ tab: event.currentTarget.dataset.tab === 'register' ? 'register' : 'login', password: '', message: '' }); },
  login() { return this.run(async () => {
    try { await this.account.login({ identifier: this.data.identifier.trim(), password: this.data.password }); await this.refresh(); this.update({ message: '已登录共享账号。备份和恢复均由你手动操作。' }); }
    finally { this.update({ password: '' }); }
  }); },
  sendCode() { if (this.data.cooldown) return; return this.run(async () => {
    const result = await this.account.request('code', 'POST', { email: this.data.email.trim() });
    this.update({ message: result.message || '验证码已发送。', cooldown: 60 });
    clearInterval(this.cooldownTimer);
    this.cooldownTimer = setInterval(() => { if (this.closed || this.data.cooldown <= 1) { clearInterval(this.cooldownTimer); if (!this.closed) this.update({ cooldown: 0 }); }
      else this.update({ cooldown: this.data.cooldown - 1 }); }, 1000);
  }); },
  register() { return this.run(async () => {
    try { await this.account.register({ username: this.data.username.trim(), email: this.data.email.trim(), code: this.data.code.trim(), password: this.data.password });
      await this.refresh(); this.update({ code: '', message: '共享账号已创建，可在 Brclio 和接入的平台使用。' }); }
    finally { this.update({ password: '' }); }
  }); },
  logout() { return this.run(async () => {
    try { await this.account.logout(); } finally { this.update({ user: null, cloudLabel: '尚未读取', cloudCount: null, password: '', currentPassword: '', newPassword: '', confirmPassword: '' }); }
    this.update({ message: '已退出登录，本机挑战记录与偏好仍然保留。' });
  }); },
  saveProfile() { return this.run(async () => {
    await this.account.request('profile', 'PUT', { username: this.data.username.trim(), nickname: this.data.nickname.trim() });
    await this.refresh(); this.update({ message: '账号资料已保存。' });
  }); },
  savePassword() { return this.run(async () => {
    if (this.data.newPassword !== this.data.confirmPassword) throw new Error('两次输入的新密码不一致。');
    try { await this.account.request('password', 'POST', { ...(this.data.passwordEnabled ? { currentPassword: this.data.currentPassword } : {}), newPassword: this.data.newPassword });
      await this.refresh(); this.update({ message: '密码已保存，其他设备的会话需要重新登录。' }); }
    finally { this.update({ currentPassword: '', newPassword: '', confirmPassword: '' }); }
  }); },
  showCloud(value) {
    let count = null;
    if (value.data.duel) count = validateDuel(value.data.duel).matches.length;
    const date = value.updatedAt ? new Date(value.updatedAt) : null;
    const saved = date && Number.isFinite(date.getTime()) ? new Date(date.getTime() + 8 * 3600000).toISOString().replace('T', ' ').slice(0, 19) + ' 北京时间' : '';
    this.update({ cloudCount: count, cloudLabel: `版本 ${value.revision}` + (saved ? ' · ' + saved : ' · 暂无备份') });
  },
  readCloud() { return this.run(async () => { const cloud = await this.account.loadCloud(); this.showCloud(cloud); this.update({ message: '已读取云端概况，本机数据未更改。' }); }); },
  confirm(title, content, confirmText) {
    return new Promise(resolve => wx.showModal({ title, content, confirmText, confirmColor: '#2b7fd8', success: result => resolve(result.confirm === true), fail: () => resolve(false) }));
  },
  backup() { return this.run(async () => {
    const cloud = await this.account.loadCloud(), local = this.account.localSnapshot(); this.showCloud(cloud);
    const remote = cloud.data.duel ? validateDuel(cloud.data.duel).matches.length : 0;
    const name = this.account.currentUser().nickname || this.account.currentUser().username;
    if (!await this.confirm('预览备份到账号', `目标账号：${name}\n本机：${local.matches.length} 场；云端：${remote} 场。\n将以本机最近 20 场和赛制、振动、玩家名替换此账号的小程序挑战备份。共享设备的本机记录也会一并上传。`, '确认备份') || this.closed) return;
    const saved = await this.account.backup(cloud, local); this.showCloud(saved); this.update({ message: '备份完成。其他应用的数据保持原样。' });
  }); },
  restore() { return this.run(async () => {
    const cloud = await this.account.loadCloud(), local = this.account.localSnapshot(); this.showCloud(cloud);
    if (!cloud.data.duel) throw new Error('账号中尚无挑战备份，本机数据已保留。');
    const remote = validateDuel(cloud.data.duel);
    if (!await this.confirm('预览恢复到本机', `本机：${local.matches.length} 场；云端：${remote.matches.length} 场。\n将以云端记录和偏好替换本机挑战数据；恢复前完整保存一份本机副本。此操作不会修改云端。`, '确认恢复') || this.closed) return;
    await this.account.restore(cloud, local); this.update({ message: '已恢复云端挑战数据，原本机副本保存在设备中。' });
  }); },
  openPrivacy() { wx.navigateTo({ url: '/pages/privacy/index' }); }
});

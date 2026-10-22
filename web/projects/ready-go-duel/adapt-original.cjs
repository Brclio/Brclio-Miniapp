'use strict';

// The user explicitly allowed removing inaccurate voice control on 2026-10-21.
// The independently hashed original snapshot remains intact; adaptations are
// documented in SOURCE.md, including the scheduled GO sound-state correction.
function adaptOriginal(original) {
  let source = original;
  function replace(before, after) {
    if (!source.includes(before)) throw new Error('Original adaptation anchor missing: ' + before.slice(0, 100));
    source = source.replace(before, after);
  }
  function removeBetween(start, end, replacement = '') {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    if (from < 0 || to < 0) throw new Error('Original adaptation range missing: ' + start);
    source = source.slice(0, from) + replacement + source.slice(to);
  }

  replace('https://ai.bornforthis.cn/images/ReadyGoDuel.png', './assets/ReadyGoDuel.png');
  replace("type WinReason = 'REACTION' | 'FALSE_START' | 'VOICE_TRIGGER' | null;", "type WinReason = 'REACTION' | 'FALSE_START' | null;");
  replace("type GameMode = 'TOUCH' | 'VOICE' | 'INFINITE';", "type GameMode = 'TOUCH' | 'INFINITE';");
  replace('VolumeX, Mic, MicOff, Activity, RefreshCw, BarChart3,', 'VolumeX, RefreshCw,');
  removeBetween('interface GameLog {', '// 无限模式单局记录');
  removeBetween('// --- 声纹可视化组件 ---', '// --- 工具函数：安全播放音频');
  replace("    if (mode === 'VOICE' && type === 'go') return;\n", '');
  removeBetween('// --- 工具函数：音高检测 ---', '// --- Canvas 绘制圆角矩形辅助函数 ---');
  replace("    const [detectedFreq, setDetectedFreq] = useState<number>(0); \n    const [currentVolume, setCurrentVolume] = useState<number>(0); \n", '');
  removeBetween('    // Debug & 状态标识', '    const fileInputRef =');
  replace('    const startTimeRef = useRef<number>(0);\n', '');
  replace('    const signalTimestampRef = useRef<number>(0); \n', '');
  removeBetween('    const historyRecorder =', '    // 初始化：读取本地存储');
  replace('    useEffect(() => { isReplayingRef.current = isReplaying; }, [isReplaying]); ', '');
  removeBetween('    // 组件卸载清理', '    // --- 战报生成逻辑 ---', '    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);\n\n');
  replace("const modeName = gameMode === 'INFINITE' ? '无限世界' : (gameMode === 'TOUCH' ? '触摸模式' : '声控模式');", "const modeName = gameMode === 'INFINITE' ? '无限世界' : '触摸模式';");
  replace("                } else if (winReason === 'VOICE_TRIGGER') {\n                    ctx.fillText(`触发频率: ${detectedFreq} Hz`, width / 2, yPos); yPos += 50;\n", '');
  replace('        fullAudioCleanup();', '        if (timerRef.current) clearTimeout(timerRef.current);');
  for (const line of [
    '        setReplayShockwave(null);\n', '        setIsReplaying(false);\n', '        setIsSavingAudio(false);\n', '        setGameHistory([]); \n'
  ]) source = source.replaceAll(line, '');
  removeBetween('        fullAudioCleanup();', "        setGameState('WAITING');", '        if (timerRef.current) clearTimeout(timerRef.current);\n\n');
  removeBetween('        setDetectedFreq(0);', "        if (soundEnabled) safePlaySound('start', gameMode);");
  removeBetween('        const now = Date.now();\n        startTimeRef.current = now;', '        // 根据设置的最大等待时间计算随机延迟');
  removeBetween('    const startRecording =', '    const triggerSignal =');
  replace('        signalTimestampRef.current = now;\n', '');
  replace("        historyRecorder.current.push({ step: 'GO', timestamp: now - startTimeRef.current });\n", '');
  removeBetween('    const handleVoiceTrigger =', '    const handleTouchAction =');
  removeBetween('        const logEntry: GameLog =', '    useEffect(() => {\n        const handleKeyDown', '    };\n\n');
  replace("            if (gameMode === 'VOICE' && gameState !== 'IDLE') return; \n", '');
  source = source.replaceAll(' && !isReplaying', '').replaceAll('!isReplaying && ', '');
  replace('[gameState, isReplaying, gameMode,', '[gameState, gameMode,');
  replace("        if (isReplaying && gameState === 'ENDED' && !isWinner) bgColor = 'bg-gray-200 opacity-30';\n", '');
  replace("        const showShockwave = isReplaying && replayShockwave === id;\n", '');
  removeBetween("        } else if (gameMode === 'VOICE') {", '        } else {');
  replace("                    if (gameMode !== 'VOICE') { e.preventDefault(); handleTouchAction(id); }", '                    e.preventDefault(); handleTouchAction(id);');
  removeBetween('                                {showShockwave && (', '                                {IconComponent}');
  removeBetween("                        {gameMode === 'VOICE' && subLabel", '                        <p className="text-xs sm:text-sm font-medium');
  replace("{gameMode === 'VOICE' ? '喊出声音!' : keyLabel}", '{keyLabel}');
  replace('keyLabel, subLabel, hasReward', 'keyLabel, hasReward');
  replace('subLabel?: string, ', '');
  replace('                    subLabel="高音区" \n', '');
  replace('                    subLabel="低音区" \n', '');
  replace('            {/* 撒礼花特效 (回放时隐藏) */}', '            {/* 原版撒礼花特效 */}');
  replace("                        <button onClick={() => switchGameMode('VOICE')} className={`p-1.5 rounded-full transition-all ${gameMode === 'VOICE' ? 'bg-white shadow text-rose-600' : 'text-gray-400 hover:text-gray-600'}`} title=\"声控模式\"><Mic size={16}/></button>\n", '');
  replace("${isSavingAudio ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}", 'bg-indigo-600 hover:bg-indigo-700');
  replace('                            disabled={isSavingAudio}\n', '');
  replace('{isSavingAudio ? <Loader2 size={20} className="animate-spin" /> : <RotateCcw size={20} />}', '<RotateCcw size={20} />');
  // Retain the original triangle test tone in settings after removing mic precheck.
  replace('<Settings className="text-indigo-600"/> 游戏设置', '<Settings className="text-indigo-600"/> 游戏设置\n                            <button onClick={() => safePlaySound(\'test\', gameMode)} className="ml-auto flex items-center gap-1 text-xs text-indigo-500 font-bold" title="试听音效"><Music size={14}/> 试听</button>');
  // Keep portal navigation and the optional score mode inside settings so the
  // original full-height court and bottom-right DIY/PV widget remain untouched.
  const settingsEnd = '                        </div>\n                    </div>\n                </div>\n            )}\n';
  const settingsStart = source.indexOf('            {/* 综合设置面板 */}');
  const settingsClose = source.indexOf(settingsEnd, settingsStart);
  if (settingsStart < 0 || settingsClose < 0) throw new Error('Original settings footer missing');
  const navigation = '\n                        <nav aria-label="内容空间导航" className="flex justify-center gap-4 mt-4 pt-3 border-t border-gray-100 text-xs text-gray-400">\n                            <a className="hover:text-indigo-600" href="/?category=relax">返回内容空间</a>\n                            <a className="hover:text-indigo-600" href="./match/">计分扩展</a>\n                        </nav>';
  const navigationAt = settingsClose + '                        </div>'.length;
  source = source.slice(0, navigationAt) + navigation + source.slice(navigationAt);
  replace("{gameMode === 'VOICE' ? '声控模式' : (gameMode === 'INFINITE' ? '无限模式' : '触摸模式')}", "{gameMode === 'INFINITE' ? '无限模式' : '触摸模式'}");
  replace("{gameMode === 'VOICE' ? '谁先发声谁赢' : (gameMode === 'INFINITE' ? '无限世界挑战' : '双人反应对决')}", "{gameMode === 'INFINITE' ? '无限世界挑战' : '双人反应对决'}");
  replace('                            {gameMode === \'VOICE\' && <>看到 <strong className="text-rose-500">GO</strong> 信号时，立即喊出声音。</>}\n', '');
  removeBetween("                    {gameMode === 'VOICE' && (", '                    <button \n                        onClick={handleStartClick}');
  replace("${gameMode === 'VOICE' ? 'bg-gradient-to-r from-rose-500 to-pink-600' : (gameMode === 'INFINITE' ? 'bg-gradient-to-r from-purple-600 to-indigo-600' : 'bg-gradient-to-r from-indigo-600 to-violet-600')}", "${gameMode === 'INFINITE' ? 'bg-gradient-to-r from-purple-600 to-indigo-600' : 'bg-gradient-to-r from-indigo-600 to-violet-600'}");
  replace('                                {gameMode === \'VOICE\' && <div className="absolute inset-0 rounded-full bg-rose-400 opacity-30 transition-transform duration-75 ease-out" style={{ transform: `scale(${1 + currentVolume})` }}></div>}\n', '');
  replace("{gameMode === 'VOICE' ? <MicOff size={32}/> : '...'}", "{'...'}");
  replace("{gameMode === 'VOICE' ? '保持安静...' : '等待信号'}", '等待信号');
  replace("${gameMode === 'VOICE' ? 'bg-rose-500 ring-rose-200' : 'bg-green-500 ring-green-200'}", 'bg-green-500 ring-green-200');
  replace("{gameMode === 'VOICE' ? '喊!' : 'GO!'}", 'GO!');
  replace('                            // 动态 class：回放时去除白色背景和阴影\n', '');
  replace("${isReplaying ? '' : 'bg-white p-4 rounded-2xl shadow-2xl border border-gray-100'}", 'bg-white p-4 rounded-2xl shadow-2xl border border-gray-100');
  replace('                                        {detectedFreq > 0 && gameMode === \'VOICE\' && <div className="text-xs text-gray-400 mt-1">检测频率: {detectedFreq}Hz</div>}\n', '');
  replace(" && (gameMode === 'TOUCH' || gameMode === 'INFINITE' || winReason !== 'FALSE_START')", '');
  removeBetween('                                            ) : (\n                                                gameHistory.length', '                                        </div>\n                                    </>', '                                            ) : null}\n');
  removeBetween('                                {isReplaying ? (', '                            </div>\n                        )}');
  removeBetween("                {gameState === 'ENDED' && gameHistory.length", '            </div>');

  // A delayed GO callback must use the latest sound switch rather than the
  // value captured when the round was launched.
  replace("    const stateRef = useRef<GameState>('IDLE');", "    const stateRef = useRef<GameState>('IDLE');\n    const soundEnabledRef = useRef(soundEnabled);");
  replace('    useEffect(() => { stateRef.current = gameState; }, [gameState]);', '    useEffect(() => { stateRef.current = gameState; }, [gameState]);\n    useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);');
  replace("        if (soundEnabled) safePlaySound('go', gameMode);", "        if (soundEnabledRef.current) safePlaySound('go', gameMode);");

  // All persisted settings use the settled account scope. Rewards remain local
  // because the shared sync schema excludes their keys.
  if ((source.match(/\blocalStorage\./g) || []).length !== 23) throw new Error('Original storage adaptation count changed');
  source = "import { moduleStorage } from '../../account-module.js';\nconst unreadableSettings = new Set<string>();\nconst settingsStorage = {\n    getItem(key: string) { try { const value = moduleStorage.getItem(key); unreadableSettings.delete(key); return value; } catch (_) { unreadableSettings.add(key); return null; } },\n    setItem(key: string, value: string) { if (unreadableSettings.has(key)) return; try { moduleStorage.setItem(key, value); } catch (_) {} },\n    removeItem(key: string) { if (unreadableSettings.has(key)) return; try { moduleStorage.removeItem(key); } catch (_) {} }\n};\n" + source.replaceAll('localStorage.', 'settingsStorage.');
  replace('    const [soundEnabled, setSoundEnabled] = useState(true);', "    const [soundEnabled, setSoundEnabled] = useState(() => settingsStorage.getItem('RGD_SOUND_ENABLED') !== 'false');");
  replace('onClick={() => setSoundEnabled(!soundEnabled)}', "onClick={() => { settingsStorage.setItem('RGD_SOUND_ENABLED', String(!soundEnabled)); setSoundEnabled(!soundEnabled); }}");

  if (/VOICE|isReplaying|isSavingAudio|gameHistory|MediaRecorder|getUserMedia|micStream|AudioVisualizer|detectPitch|recording|replay/i.test(source)) {
    throw new Error('A removed voice or recording capability remains in adapted source');
  }
  return source;
}

module.exports = { adaptOriginal };

if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const original = fs.readFileSync(path.join(__dirname, 'upstream/App.tsx'), 'utf8');
  fs.writeFileSync(path.join(__dirname, 'App.tsx'), adaptOriginal(original));
}

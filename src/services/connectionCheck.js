export function connectionError(message) {
  const text = String(message || '');
  if (/未配置|缺少/.test(text)) return '所选服务商的密钥未配置，请打开 AI 设置。';
  if (/无法解密/.test(text)) return '保存的密钥无法解密，请在 AI 设置中删除并重新填写。';
  if (/加密不可用/.test(text)) return '系统密钥加密不可用，无法保存密钥。';
  if (/设置文件/.test(text)) return 'AI 设置文件无法读取，请备份后恢复文件。';
  if (/连接已断开/.test(text)) return '语音连接已断开，按 Alt+Q 重新连接；无需再次保存密钥。';
  if (/请选择实时语音服务商/.test(text)) return '请选择实时语音服务商，请打开 AI 设置。';
  if (/401|api.?key|unauthenticated|invalid.*key|authentication/i.test(text)) return '密钥无效或已过期，请在 AI 设置中更换密钥。';
  if (/429|quota|balance|credit|billing|resource.?exhausted/i.test(text)) return '账户额度不足或请求过于频繁，请检查服务商账户后重试。';
  if (/403|access.?denied|permission|forbidden/i.test(text)) return '服务商拒绝访问，请检查密钥权限、模型权限及账户余额。';
  if (/model|voice|unsupported|not.?found|invalid.?argument/i.test(text)) return '模型或音色不可用，请检查 AI 设置及服务商的支持范围。';
  if (/timeout|timed.?out|超时/i.test(text)) return '连接超时，请检查网络或代理后重试。';
  return '连接失败，请检查网络、代理和服务商状态，然后手动重试。';
}

/** Opens a temporary, silent provider session; always closes it. */
export function checkVoiceConnection(engine, { timeoutMs = 20000, signal } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      engine.off('session_ready', ready);
      engine.off('session_configured', ready);
      engine.off('status', status);
      signal?.removeEventListener('abort', cancelled);
      engine.disconnect();
      engine.apiKey = null;
      resolve(result);
    };
    const ready = () => finish({ ok: true, message: '服务商会话已就绪；测试未启用麦克风。' });
    const status = event => { if (event.status === 'error') finish({ ok: false, message: connectionError(event.error) }); };
    const cancelled = () => finish({ ok: false, message: '测试已取消，请重新测试。' });
    const timer = setTimeout(() => finish({ ok: false, message: '连接超时，请检查网络或代理后重试。' }), timeoutMs);
    // Qwen's initial session.created precedes acceptance of model/voice config.
    engine.on(engine.provider === 'qwen' ? 'session_configured' : 'session_ready', ready);
    engine.on('status', status);
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) { cancelled(); return; }
    try { Promise.resolve(engine.connect()).catch(() => status({ status: 'error', error: 'network' })); }
    catch { status({ status: 'error', error: 'network' }); }
  });
}

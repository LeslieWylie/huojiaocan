// 账号 login + AI 设置页（从 App.jsx 迁出）
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, MessageCircle, Plus, Route, ShieldCheck } from 'lucide-react';
import { Badge, SectionHead } from '../ui-kit.jsx';
import { askErrorMessage, queryParams, rootRequest } from '../app-core.js';
import {
  clearAuthRecovery, consumeAuthCallback, getSession, readAuthRecovery,
  resendVerification, safeAuthReturnPath, signIn, signUp
} from '../auth.js';
export function LoginPage({ callback: initialCallback = null }) {
  const params = useMemo(() => queryParams(), []);
  const recovery = useMemo(() => readAuthRecovery(), []);
  const destination = safeAuthReturnPath(params.get('next') || recovery?.next || '/ask/');
  const [callback] = useState(() => initialCallback || consumeAuthCallback());
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(() => callback?.type === 'session' ? '邮箱已验证，正在进入备课工作台…' : '');
  const [resendMessage, setResendMessage] = useState('');
  const callbackError = callback?.type === 'error'
    ? callback
    : params.get('auth_error')
      ? { code: params.get('auth_error'), description: params.get('auth_description') || '' }
      : null;
  useEffect(() => {
    if (message && getSession()) {
      const timer = window.setTimeout(() => { location.replace(destination); }, 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [message, destination]);
  useEffect(() => {
    if (!params.has('auth_error')) return;
    const clean = new URLSearchParams(params);
    clean.delete('auth_error');
    clean.delete('auth_description');
    history.replaceState(null, document.title, `${location.pathname}${clean.toString() ? `?${clean}` : ''}`);
  }, [params]);
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    const minimumLength = mode === 'signin' ? 6 : 8;
    if (password.length < minimumLength) {
      setError(mode === 'signin' ? '密码至少需要 6 位，请检查后重试。' : '创建账号时请使用至少 8 位密码。');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      const session = mode === 'signin' ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
      if (mode === 'signup' && !session?.access_token) {
        setMessage('注册成功。请先完成邮箱验证，再返回这里登录。');
      } else {
        // Keep the short-lived recovery payload until /ask or /cards has
        // restored it. Clearing here loses the question and prior turns.
        if (!readAuthRecovery()) clearAuthRecovery();
        location.href = destination;
      }
    } catch (err) {
      const code = err.code || err.message || 'auth_failed';
      setError(code === 'auth_invalid' ? '邮箱或密码不正确。' : code === 'auth_not_configured' ? '账号服务尚未配置，请联系管理员。' : code === 'auth_configuration_unreachable' ? '账号服务地址需要更新，当前暂时无法登录。' : code === 'auth_unavailable' ? '账号服务暂时没有响应，请稍后再试。' : code === 'auth_rate_limited' ? '验证请求过于频繁，请稍后再试。' : code === 'email_not_confirmed' ? '邮箱还没有完成验证，请先点击验证邮件。' : code === 'otp_expired' ? '邮箱验证链接已过期，请重新获取验证邮件或直接登录。' : code === 'redirect_to_not_allowed' ? '当前地址未加入账号服务的允许回调地址，请联系部署人员配置。' : code === 'user_already_exists' ? '该邮箱已注册，请直接登录。' : code === 'weak_password' ? '密码强度不足，请使用至少 8 位密码。' : code === 'auth_failed' ? '登录请求未完成，请检查账号与密码后重试。' : '账号操作暂时没有完成，请稍后重试。');
    } finally { setBusy(false); }
  };
  const resend = async () => {
    if (resendBusy || !email.trim()) {
      setError('请先填写注册邮箱，再重新获取验证邮件。');
      return;
    }
    setResendBusy(true); setError(''); setResendMessage('');
    try {
      await resendVerification(email);
      setResendMessage('验证邮件已重新发送，请在邮件中打开最新链接。');
    } catch (err) {
      const code = err.code || err.message || 'auth_failed';
      setError(code === 'auth_unavailable' ? '账号服务暂时没有响应，请稍后再试。' : code === 'auth_rate_limited' ? '验证邮件发送过于频繁，请稍后再试。' : '验证邮件暂时没有发送成功，请稍后重试。');
    } finally { setResendBusy(false); }
  };
  const callbackMessage = callbackError?.code === 'otp_expired'
    ? '邮箱验证链接已过期或已被使用。请重新获取验证邮件，或直接使用密码登录。'
    : callbackError?.code === 'access_denied'
      ? '邮箱验证没有完成，请重新获取验证邮件后再试。'
      : callbackError
        ? '邮箱验证暂未完成，请重新获取验证邮件后再试。'
        : '';
  const canResend = callbackError && ['otp_expired', 'access_denied'].includes(callbackError.code);
  return <div className="view-stack auth-page"><section className="hero compact-hero"><div><Badge tone="green"><ShieldCheck/> 账号与 AI</Badge><h1>登录后，把备课方案<br/><em>保存为自己的课堂资产</em></h1><p>公共教材无需登录即可翻阅；登录后，你可以保存问答、课堂方案和一课三卡，并在下次备课时继续编辑。</p></div></section><section className="panel auth-panel"><div className="auth-tabs"><button className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(''); }}>登录</button><button className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>注册</button></div>{callbackMessage && <div className="ask-error"><CircleAlert/><span>{callbackMessage}</span></div>}<form onSubmit={submit} className="auth-form" noValidate><label>邮箱<input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" placeholder="name@example.com"/></label><label>密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={mode === 'signin' ? 6 : 8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} placeholder={mode === 'signin' ? '输入登录密码' : '至少 8 位'}/><small>{mode === 'signin' ? '登录已有账号时，密码至少 6 位。' : '创建账号时请使用至少 8 位密码。'}</small></label>{error && <div className="ask-error"><CircleAlert/>{error}</div>}{message && <div className="quality-box"><CheckCircle2/>{message}</div>}<button className="primary" disabled={busy || Boolean(message)}>{busy ? '正在验证…' : mode === 'signin' ? '登录并开始备课' : '创建账号并获取验证邮件'}</button></form>{canResend && <div className="auth-resend"><div><b>还没有收到验证邮件？</b><small>填写注册邮箱后，发送一封新的验证邮件。请只打开最新邮件中的链接。</small></div><button type="button" onClick={resend} disabled={resendBusy}>{resendBusy ? '正在发送…' : '重新发送验证邮件'}</button></div>}{resendMessage && <div className="quality-box"><CheckCircle2/>{resendMessage}</div>}<small className="muted">你的智能连接信息仅由系统加密保存，页面不会显示完整内容。</small></section></div>;
}

export function SettingsPage() {
  const [keys, setKeys] = useState([]); const [model, setModel] = useState('deepseek-v4-flash'); const [apiKey, setApiKey] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const load = () => rootRequest('/api/ai/keys').then(data => setKeys(data.keys || [])).catch(err => setError(askErrorMessage(err)));
  useEffect(() => { if (!getSession()) { location.href = '/login/?next=%2Fsettings%2F'; return; } load(); }, []);
  const add = async event => { event.preventDefault(); if (busy || !apiKey.trim()) return; setBusy(true); setError(''); setMessage(''); try { const data = await rootRequest('/api/ai/keys', { method: 'POST', body: { apiKey: apiKey.trim(), model } }); setKeys(value => [data.key, ...value]); setApiKey(''); setMessage('密钥已安全保存。建议先测试连接，再切换为当前使用的密钥。'); } catch (err) { setError(askErrorMessage(err)); } finally { setBusy(false); } };
  const action = async (id, kind) => { setBusy(true); setError(''); setMessage(''); try { const data = await rootRequest(`/api/ai/keys/${encodeURIComponent(id)}/${kind}`, { method: 'POST' }); setKeys(value => value.map(item => item.id === id ? { ...item, ...(data.key || {}), ...(data.result || {}) } : kind === 'activate' ? { ...item, isActive: false } : item)); setMessage(kind === 'test' ? 'DeepSeek 连接测试完成。' : '已切换当前使用的 AI 来源。'); } catch (err) { setError(askErrorMessage(err)); } finally { setBusy(false); } };
  const remove = async id => { if (busy) return; setBusy(true); setError(''); try { await rootRequest(`/api/ai/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }); setKeys(value => value.filter(item => item.id !== id)); } catch (err) { setError(askErrorMessage(err)); } finally { setBusy(false); } };
  return <div className="view-stack settings-page"><section className="hero compact-hero"><div><Badge tone="blue"><ShieldCheck/> AI 设置</Badge><h1>配置你的 AI 连接<br/><em>再开始生成备课方案</em></h1><p>系统 AI 默认使用已配置的系统智能；你也可以添加自己的 DeepSeek 密钥。页面只显示末四位和测试状态，完整密钥不会返回浏览器。</p></div></section><section className="panel"><SectionHead icon={Plus} eyebrow="添加我的智能连接" title="配置 DeepSeek 官方接口" note="仅支持已接入的智能模型。这里保存的是你的智能连接，不要粘贴系统配置密钥。"/><form onSubmit={add} className="key-form"><label>模型<select value={model} onChange={event => setModel(event.target.value)}><option value="deepseek-v4-flash">标准智能模型</option><option value="deepseek-v4-pro">增强智能模型</option></select></label><label>DeepSeek 密钥<input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sk-…" autoComplete="off"/></label><button className="primary" disabled={busy || !apiKey.trim()}>添加并保存</button></form>{error && <div className="ask-error"><CircleAlert/>{error}</div>}{message && <div className="quality-box"><CheckCircle2/>{message}</div>}</section><section className="panel"><SectionHead icon={ShieldCheck} eyebrow="已保存的我的智能连接" title="切换与测试" note="完整密钥不会返回浏览器。备课问答中选择“系统智能（默认）”即可使用系统 AI。"/><div className="key-list">{keys.length ? keys.map(item => <article className="key-row" key={item.id}><div><b>{item.keyHint || 'DeepSeek 密钥'}</b><small>{item.model} · {item.lastTestStatus === 'valid' ? '测试通过' : item.lastTestStatus === 'invalid' ? '测试失败' : '尚未测试'}</small></div><Badge tone={item.isActive ? 'green' : 'neutral'}>{item.isActive ? '当前使用' : '未启用'}</Badge><button disabled={busy} onClick={() => action(item.id, 'test')}>测试</button>{!item.isActive && <button disabled={busy} onClick={() => action(item.id, 'activate')}>设为当前</button>}<button disabled={busy} onClick={() => remove(item.id)}>删除</button></article>) : <p className="muted">还没有保存我的智能连接。系统 AI 可以直接使用；添加我的智能连接后，也可以在问答页切换。</p>}</div></section><div className="hero-actions settings-return"><a className="primary" href="/ask/"><MessageCircle/>返回备课问答</a><a href="/"><Route/>返回教学任务</a></div></div>;
}


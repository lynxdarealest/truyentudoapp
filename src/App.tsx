import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Play, Square, Upload, Trash2, Key, CheckCircle2, Terminal, Server, Shield, Activity, Smartphone, RefreshCw } from 'lucide-react';
import './index.css';

type CredentialStatus = 'Ready' | 'In Use' | 'Limit Exceeded' | 'Expired' | 'Invalid Token' | 'Refreshing';

interface Credential {
  id: string;
  project_id?: string;
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token?: string;
  token_expiry?: number;
  status: CredentialStatus;
  requestsUsed: number;
  lastResetTime: number;
  email?: string;
}

const DEFAULT_WS_URL = 'wss://relay2026.vercel.app/code=';

const OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || "";
const OAUTH_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_SECRET || "";
const OAUTH_REDIRECT_URI = `${window.location.origin}/`;
const OAUTH_SCOPES = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";
const OAUTH_STORAGE_KEY = "google_oauth_pkce";

const base64UrlEncode = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const generateCodeVerifier = () => {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  return base64UrlEncode(random.buffer);
};

const generateCodeChallenge = async (verifier: string) => {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
};

const refreshToken = async (cred: Credential): Promise<Partial<Credential> | null> => {
  try {
    const params = new URLSearchParams({
      client_id: cred.client_id,
      refresh_token: cred.refresh_token,
      grant_type: 'refresh_token'
    });
    if (cred.client_secret) params.append('client_secret', cred.client_secret);

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params
    });
    const data = await res.json();
    if (data.access_token) {
      return {
        access_token: data.access_token,
        token_expiry: Date.now() + data.expires_in * 1000,
        status: 'Ready'
      };
    }
    return null;
  } catch (e) {
    return null;
  }
};

const GuideModal = ({ onClose }: { onClose: () => void }) => (
  <div className="ttd-overlay">
    <div className="ttd-modal">
      <h2 className="ttd-modal-title">Hướng dẫn Truyện Tự Do</h2>
      <ol className="ttd-list">
        <li>Tạo ứng dụng đăng nhập Google (OAuth) với Redirect URI: {OAUTH_REDIRECT_URI}</li>
        <li>Chọn "Đăng nhập Google" để mở popup đăng nhập.</li>
        <li>Hệ thống tự nhận callback, bạn không cần copy URL thủ công.</li>
        <li>Sau khi thành công, thêm tài khoản vào danh sách.</li>
        <li>Nhập đường dẫn kênh kết nối (WebSocket) và bấm kết nối.</li>
        <li>Trong app Truyện Tự Do, dán cùng đường dẫn vào phần Custom/Base URL.</li>
      </ol>
      <button onClick={onClose} className="ttd-btn ttd-btn-primary ttd-w-full">
        Đã hiểu
      </button>
    </div>
  </div>
);

const OAuthModal = ({ onClose, onAddCredential }: { onClose: () => void, onAddCredential: (c: Credential) => void }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [authStatus, setAuthStatus] = useState('');
  const [result, setResult] = useState<Credential | null>(null);
  const popupRef = useRef<Window | null>(null);

  const handleExchange = useCallback(async (code: string, verifier: string) => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        code,
        grant_type: 'authorization_code',
        redirect_uri: OAUTH_REDIRECT_URI,
        code_verifier: verifier
      });
      if (OAUTH_CLIENT_SECRET) params.append('client_secret', OAUTH_CLIENT_SECRET);
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error_description || data.error);
      if (!data.refresh_token) {
        throw new Error('Google không trả refresh_token. Hãy xoá quyền app trong tài khoản Google rồi thử lại.');
      }

      const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      const userData = await userRes.json();

      const cred: Credential = {
        id: Math.random().toString(36).substring(7),
        client_id: OAUTH_CLIENT_ID,
        client_secret: OAUTH_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        access_token: data.access_token,
        token_expiry: Date.now() + data.expires_in * 1000,
        status: 'Ready',
        requestsUsed: 0,
        lastResetTime: Date.now(),
        email: userData.email,
        project_id: 'Gemini CLI OAuth'
      };

      setResult(cred);
      setStep(4);
    } catch (err: any) {
      setError(err.message);
    } finally {
      sessionStorage.removeItem(OAUTH_STORAGE_KEY);
      setLoading(false);
      if (popupRef.current && !popupRef.current.closed) popupRef.current.close();
      popupRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; code?: string; error?: string; state?: string };
      if (data.type !== 'oauth_callback') return;

      const saved = sessionStorage.getItem(OAUTH_STORAGE_KEY);
      if (!saved) {
        setError('Không tìm thấy phiên đăng nhập OAuth.');
        return;
      }

      const parsed = JSON.parse(saved) as { state: string; verifier: string };
      if (!data.state || data.state !== parsed.state) {
        setError('State OAuth không khớp, vui lòng thử lại.');
        return;
      }

      if (data.error) {
        setError(`Đăng nhập thất bại: ${data.error}`);
        setStep(2);
        return;
      }

      if (!data.code) {
        setError('Không nhận được mã OAuth.');
        return;
      }

      setAuthStatus('Đã nhận mã OAuth, đang lấy token...');
      handleExchange(data.code, parsed.verifier);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handleExchange]);

  const handleLogin = useCallback(async () => {
    try {
      if (!OAUTH_CLIENT_ID) {
        setError('Thiếu VITE_GOOGLE_OAUTH_CLIENT_ID. Hãy cấu hình biến môi trường trước.');
        return;
      }

      const state = crypto.randomUUID();
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      sessionStorage.setItem(OAUTH_STORAGE_KEY, JSON.stringify({ state, verifier }));

      const params = new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: OAUTH_REDIRECT_URI,
        response_type: 'code',
        scope: OAUTH_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      });

      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
      popupRef.current = window.open(authUrl, 'google_oauth', 'width=520,height=760');
      if (!popupRef.current) {
        throw new Error('Trình duyệt chặn popup. Hãy cho phép popup và thử lại.');
      }

      setError('');
      setAuthStatus('Đang chờ hoàn tất đăng nhập từ popup...');
      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Không thể bắt đầu đăng nhập OAuth.');
    }
  }, []);

  return (
    <div className="ttd-overlay">
      <div className="ttd-modal">
        <h2 className="ttd-modal-title">Thêm tài khoản Google</h2>
        
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="ttd-subtitle">Bước 1: Đăng nhập Google</h3>
            <p className="ttd-muted">Popup sẽ đăng nhập và callback về domain hiện tại.</p>
            <p className="ttd-small">Redirect URI: {OAUTH_REDIRECT_URI}</p>
            <button onClick={handleLogin} className="ttd-btn ttd-btn-light ttd-w-full">
              Đăng nhập bằng Google
            </button>
            {error && <p className="ttd-error">{error}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h3 className="ttd-subtitle">Bước 2: Chờ callback OAuth</h3>
            <p className="ttd-muted">Sau khi cấp quyền, app sẽ tự lấy token.</p>
            <div className="ttd-status-box">
              {authStatus || 'Đang chờ đăng nhập...'}
            </div>
            {error && <p className="ttd-error">{error}</p>}
            <button onClick={handleLogin} disabled={loading} className="ttd-btn ttd-btn-primary ttd-w-full">
              Mở lại popup đăng nhập
            </button>
          </div>
        )}

        {step === 4 && result && (
          <div className="space-y-4">
            <h3 className="ttd-subtitle">Hoàn tất</h3>
            <div className="ttd-success-box">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-emerald-700">Thành công! Tài khoản đã sẵn sàng.</p>
                <p className="ttd-small">Email: {result.email}</p>
              </div>
            </div>
            <button 
              onClick={() => { onAddCredential(result); onClose(); }}
              className="ttd-btn ttd-btn-primary ttd-w-full"
            >
              Thêm vào danh sách
            </button>
            <button
              onClick={() => {
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(result, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", "gemini_credential.json");
                document.body.appendChild(downloadAnchorNode);
                downloadAnchorNode.click();
                downloadAnchorNode.remove();
              }}
              className="ttd-btn ttd-btn-ghost ttd-w-full"
            >
              Tải JSON về máy
            </button>
          </div>
        )}

        <button onClick={onClose} className="ttd-btn ttd-btn-link ttd-w-full">
          Hủy
        </button>
      </div>
    </div>
  );
};

const App = () => {
  const [wsUrl, setWsUrl] = useState(localStorage.getItem('wsUrl') || DEFAULT_WS_URL);
  const [wsCode, setWsCode] = useState(localStorage.getItem('wsCode') || '');
  const [isConnected, setIsConnected] = useState(false);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [isKeepAliveEnabled, setIsKeepAliveEnabled] = useState(localStorage.getItem('keepAlive') === 'true');
  const [isAutoRefreshEnabled, setIsAutoRefreshEnabled] = useState(localStorage.getItem('autoRefresh') === 'true');
  const [logs, setLogs] = useState<{time: Date, msg: string, type: 'info'|'error'|'success'}[]>([]);
  
  const [credentials, setCredentials] = useState<Credential[]>(() => {
    const saved = localStorage.getItem('gemini_credentials');
    return saved ? JSON.parse(saved) : [];
  });

  const wsRef = useRef<WebSocket | null>(null);
  const shouldReconnectRef = useRef(false);
  const credentialsRef = useRef(credentials);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    credentialsRef.current = credentials;
    localStorage.setItem('gemini_credentials', JSON.stringify(credentials));
  }, [credentials]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = useCallback((msg: string, type: 'info'|'error'|'success' = 'info') => {
    setLogs(prev => [...prev, { time: new Date(), msg, type }].slice(-100));
  }, []);

  const startKeepAlive = useCallback(async () => {
    if (!isKeepAliveEnabled) return;

    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      if (!oscRef.current) {
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();
        osc.type = 'sine';
        osc.frequency.value = 1;
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(audioCtxRef.current.destination);
        osc.start();
        oscRef.current = osc;
      }
    } catch (e) {
      console.error('Audio keep-alive failed', e);
    }

    try {
      if (navigator.locks) {
        navigator.locks.request('gemini-proxy-keep-alive', () => new Promise(() => {}));
      }
    } catch (e) {
      console.error('Web Locks failed', e);
    }

    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    addLog('[KeepAlive] Chế độ mobile đã bật', 'info');
  }, [isKeepAliveEnabled, addLog]);

  const stopKeepAlive = useCallback(() => {
    if (oscRef.current) {
      oscRef.current.stop();
      oscRef.current.disconnect();
      oscRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('keepAlive', isKeepAliveEnabled.toString());
    if (isKeepAliveEnabled) {
      startKeepAlive();
    } else {
      stopKeepAlive();
    }
    return () => stopKeepAlive();
  }, [isKeepAliveEnabled, startKeepAlive, stopKeepAlive]);

  const updateCredential = useCallback((id: string, updates: Partial<Credential>) => {
    setCredentials(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  }, []);

  useEffect(() => {
    localStorage.setItem('autoRefresh', isAutoRefreshEnabled.toString());
  }, [isAutoRefreshEnabled]);

  useEffect(() => {
    if (!isAutoRefreshEnabled) return;
    
    const checkAndRefresh = () => {
      const now = Date.now();
      credentialsRef.current.forEach(async (cred) => {
        if (cred.status !== 'Refreshing' && cred.status !== 'Invalid Token' && cred.refresh_token) {
          const isExpired = !cred.access_token || !cred.token_expiry || (cred.token_expiry - now < 5 * 60 * 1000);
          if (isExpired) {
            addLog(`[Tự động làm mới] Phiên đăng nhập sắp hết hạn của ${cred.email || cred.project_id}, đang làm mới...`, 'info');
            updateCredential(cred.id, { status: 'Refreshing' });
            const refreshed = await refreshToken(cred);
            if (refreshed) {
              updateCredential(cred.id, refreshed);
              addLog(`[Tự động làm mới] Làm mới thành công cho ${cred.email || cred.project_id}`, 'success');
            } else {
              updateCredential(cred.id, { status: 'Invalid Token' });
              addLog(`[Tự động làm mới] Không thể làm mới cho ${cred.email || cred.project_id}`, 'error');
            }
          }
        }
      });
    };

    checkAndRefresh();
    const interval = setInterval(checkAndRefresh, 60000);
    return () => clearInterval(interval);
  }, [isAutoRefreshEnabled, addLog, updateCredential]);

  const getNextCredential = useCallback((): Credential | null => {
    const creds = credentialsRef.current;
    const now = Date.now();
    let updated = false;
    
    const newCreds = creds.map(c => {
      if (now - c.lastResetTime > 24 * 60 * 60 * 1000) {
        updated = true;
        return { ...c, requestsUsed: 0, lastResetTime: now, status: c.status === 'Limit Exceeded' ? 'Ready' : c.status };
      }
      return c;
    });
    
    if (updated) {
      setCredentials(newCreds);
      credentialsRef.current = newCreds;
    }

    const available = credentialsRef.current.filter(c => 
      c.status === 'Ready' || c.status === 'Expired'
    );
    
    if (available.length === 0) return null;
    return available.sort((a, b) => a.requestsUsed - b.requestsUsed)[0];
  }, []);

  const processRequest = useCallback(async (ws: WebSocket, req: any, initialCred: Credential) => {
    const { request_id, method, path, headers, body, query_params } = req;
    let cred = initialCred;

    const updateCred = (updates: Partial<Credential>) => {
      updateCredential(cred.id, updates);
      cred = { ...cred, ...updates };
    };

    try {
      if (!cred.access_token || Date.now() >= (cred.token_expiry || 0)) {
        addLog(`Đang làm mới phiên đăng nhập cho ${cred.email || cred.project_id}...`, 'info');
        updateCred({ status: 'Refreshing' });
        
        let success = false;
        for (let i = 0; i < 3; i++) {
          const refreshed = await refreshToken(cred);
          if (refreshed) {
            updateCred(refreshed);
            success = true;
            break;
          }
        }
        
        if (!success) {
          updateCred({ status: 'Invalid Token' });
          addLog(`Làm mới phiên đăng nhập thất bại cho ${cred.email || cred.project_id}`, 'error');
          ws.send(JSON.stringify({ request_id, event_type: "error", status: 401, message: "Failed to refresh token" }));
          return;
        }
      }

      updateCred({ status: 'In Use' });

      const url = new URL(`https://generativelanguage.googleapis.com${path}`);
      if (query_params) {
        Object.entries(query_params).forEach(([k, v]) => url.searchParams.append(k, v as string));
      }

      const fetchHeaders = new Headers();
      if (headers) {
        const forbidden = ['host', 'connection', 'content-length', 'origin', 'referer', 'user-agent'];
        Object.entries(headers).forEach(([k, v]) => {
          if (!forbidden.includes(k.toLowerCase())) {
            fetchHeaders.append(k, v as string);
          }
        });
      }
      fetchHeaders.set('Authorization', `Bearer ${cred.access_token}`);

      let fetchBody = body;
      if (body && typeof body === 'object') {
        const bodyCopy = { ...body };
        if (path.includes('/openai/') && 'extra_body' in bodyCopy) {
          delete bodyCopy.extra_body;
        }
        fetchBody = JSON.stringify(bodyCopy);
      } else if (body && typeof body === 'string') {
        try {
          const parsed = JSON.parse(body);
          if (path.includes('/openai/') && 'extra_body' in parsed) {
            delete parsed.extra_body;
            fetchBody = JSON.stringify(parsed);
          }
        } catch (e) {}
      }

      addLog(`Đang chuyển tiếp yêu cầu ${request_id} tới Gemini API`, 'info');
      
      let response = await fetch(url.toString(), {
        method: method || 'GET',
        headers: fetchHeaders,
        body: ['GET', 'HEAD'].includes(method?.toUpperCase()) ? undefined : fetchBody
      });

      if (response.status === 401 || response.status === 403) {
        addLog(`Nhận 401/403 cho ${cred.email || cred.project_id}, buộc làm mới phiên đăng nhập...`, 'error');
        const refreshed = await refreshToken(cred);
        if (refreshed) {
          updateCred(refreshed);
          fetchHeaders.set('Authorization', `Bearer ${refreshed.access_token}`);
          response = await fetch(url.toString(), {
            method: method || 'GET',
            headers: fetchHeaders,
            body: ['GET', 'HEAD'].includes(method?.toUpperCase()) ? undefined : fetchBody
          });
        } else {
          updateCred({ status: 'Invalid Token' });
          ws.send(JSON.stringify({ request_id, event_type: "error", status: 401, message: "Invalid Token" }));
          return;
        }
      }

      if (response.status === 429) {
        updateCred({ status: 'Limit Exceeded' });
        addLog(`429: Vượt giới hạn cho ${cred.email || cred.project_id}`, 'error');
        ws.send(JSON.stringify({ request_id, event_type: "error", status: 429, message: "Rate limit exceeded" }));
        return;
      }

      updateCred({ 
        status: 'Ready', 
        requestsUsed: cred.requestsUsed + 1 
      });

      const respHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => respHeaders[k] = v);

      ws.send(JSON.stringify({
        request_id,
        event_type: "response_headers",
        status: response.status,
        headers: respHeaders
      }));

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          ws.send(JSON.stringify({
            request_id,
            event_type: "chunk",
            data: chunk
          }));
        }
        ws.send(JSON.stringify({
          request_id,
          event_type: "stream_close"
        }));
        addLog(`Hoàn tất yêu cầu ${request_id}`, 'success');
      } else {
        ws.send(JSON.stringify({
          request_id,
          event_type: "stream_close"
        }));
        addLog(`Hoàn tất yêu cầu ${request_id} (không có nội dung trả về)`, 'success');
      }

    } catch (err: any) {
      addLog(`Lỗi xử lý yêu cầu ${request_id}: ${err.message}`, 'error');
      updateCred({ status: 'Ready' });
      ws.send(JSON.stringify({
        request_id,
        event_type: "error",
        status: 500,
        message: err.message
      }));
    }
  }, [addLog, updateCredential]);

  const connectWs = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
    
    try {
      const code = wsCode.trim();
      if (!/^\d{4,8}$/.test(code)) {
        addLog('Mã kết nối phải gồm 4-8 chữ số.', 'error');
        return;
      }

      const base = wsUrl.trim();
      let finalUrl = base;

      if (base.includes('/code=')) {
        finalUrl = base.replace(/\/code=\d*$/, '/code=').concat(code);
      } else {
        const urlObj = new URL(base);
        urlObj.searchParams.set('code', code);
        finalUrl = urlObj.toString();
      }

      addLog(`Đang kết nối tới ${finalUrl}...`, 'info');
      const ws = new WebSocket(finalUrl);
      wsRef.current = ws;
      
      ws.onopen = () => {
        setIsConnected(true);
        addLog('Đã kết nối máy chủ trung chuyển', 'success');
        localStorage.setItem('wsUrl', wsUrl);
        localStorage.setItem('wsCode', code);

        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);
      };
      
      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

        if (shouldReconnectRef.current) {
          addLog('Kết nối đã đóng. Đang thử lại sau 5 giây...', 'error');
          
          if (isKeepAliveEnabled && document.visibilityState !== 'visible' && Notification.permission === 'granted') {
            const notif = new Notification('⚠️ Truyện Tự Do mất kết nối', {
              body: 'Nhấn để kết nối lại.',
            });
            notif.onclick = () => {
              window.focus();
              notif.close();
              if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                connectWs();
              }
            };
          }
          setTimeout(connectWs, 5000);
        }
      };
      
      ws.onerror = () => {
        addLog('Đã xảy ra lỗi WebSocket', 'error');
      };
      
      ws.onmessage = async (event) => {
        try {
          const req = JSON.parse(event.data);
          if (!req.request_id || !req.path) return;

          addLog(`Nhận yêu cầu ${req.request_id} cho ${req.path}`, 'info');

          const cred = getNextCredential();
          if (!cred) {
            addLog(`Không còn tài khoản khả dụng cho yêu cầu ${req.request_id}`, 'error');
            ws.send(JSON.stringify({ request_id: req.request_id, event_type: "error", status: 503, message: "No available credentials" }));
            return;
          }

          processRequest(ws, req, cred);
        } catch (e) {
          console.error(e);
        }
      };
      
    } catch (err: any) {
      addLog(`WebSocket URL không hợp lệ: ${err.message}`, 'error');
      shouldReconnectRef.current = false;
    }
  }, [wsUrl, wsCode, addLog, getNextCredential, processRequest]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (isKeepAliveEnabled) {
          addLog('[KeepAlive] Tab trở lại foreground, kiểm tra kết nối...', 'info');
          if (shouldReconnectRef.current && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
            connectWs();
            addLog('[KeepAlive] Reconnect thành công sau khi tab trở lại', 'success');
          }
          credentialsRef.current.forEach(async (cred) => {
            if (cred.status === 'Ready' && cred.access_token && cred.token_expiry && Date.now() >= cred.token_expiry) {
               addLog(`[KeepAlive] Token expired for ${cred.email}, refreshing...`, 'info');
               const refreshed = await refreshToken(cred);
               if (refreshed) {
                 updateCredential(cred.id, refreshed);
               }
            }
          });
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isKeepAliveEnabled, addLog, connectWs, updateCredential]);

  const toggleConnection = () => {
    if (isConnected || wsRef.current) {
      shouldReconnectRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
      setIsConnected(false);
      addLog('Đã ngắt kết nối khỏi máy chủ trung chuyển', 'info');
    } else {
      shouldReconnectRef.current = true;
      connectWs();
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          const cred: Credential = {
            id: Math.random().toString(36).substring(7),
            project_id: json.project_id || 'Tài khoản đã nhập',
            client_id: json.client_id || json.installed?.client_id || '',
            client_secret: json.client_secret || json.installed?.client_secret || '',
            refresh_token: json.refresh_token || '',
            status: 'Ready',
            requestsUsed: 0,
            lastResetTime: Date.now(),
            email: json.client_email || 'JSON đã nhập'
          };
          if (!cred.client_id || !cred.client_secret || !cred.refresh_token) {
            addLog(`Tệp tài khoản không hợp lệ: ${file.name}`, 'error');
            return;
          }
          setCredentials(prev => [...prev, cred]);
          addLog(`Đã nhập tài khoản từ ${file.name}`, 'success');
        } catch (err) {
          addLog(`Không thể đọc ${file.name}`, 'error');
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="ttd-shell">
      <div className="ttd-bg-glow" />
      <header className="ttd-top max-w-7xl mx-auto">
        <div className="ttd-brand">
          <div className="ttd-brand-icon"><Activity className="w-6 h-6" /></div>
          <div>
            <h1>Truyện Tự Do Relay</h1>
            <p>Nền tảng trung chuyển API với cơ chế xoay vòng tài khoản thông minh</p>
          </div>
        </div>
        <button onClick={() => setShowGuide(true)} className="ttd-btn ttd-btn-ghost">Hướng dẫn</button>
      </header>

      <section className="ttd-hero max-w-7xl mx-auto">
        <div>
          <h2>Điều khiển kết nối, token và hiệu năng phản hồi trong một màn hình duy nhất</h2>
          <p>Giao diện tối ưu riêng cho Truyện Tự Do, dễ nhận diện thương hiệu và vận hành ổn định trên mobile.</p>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
        <div className="lg:col-span-2 space-y-6">
          <div className="ttd-card reveal-1">
            <h2 className="ttd-card-title"><Server className="w-5 h-5" /> Kết nối Truyện Tự Do</h2>
            <label className="ttd-label">Đường dẫn kênh kết nối (WebSocket)</label>
            <input
              type="text"
              value={wsUrl}
              onChange={e => setWsUrl(e.target.value)}
              disabled={isConnected}
              className="ttd-input"
              placeholder="wss://relay2026.vercel.app/code="
            />
            <label className="ttd-label">Mã kết nối (nếu có)</label>
            <input
              type="text"
              value={wsCode}
              onChange={e => setWsCode(e.target.value)}
              disabled={isConnected}
              className="ttd-input"
              placeholder="Nhập mã 4-8 chữ số, ví dụ: 1234 hoặc 20262026"
            />
            <p className="ttd-note">Mặc định dùng `wss://relay2026.vercel.app/code=`. Người dùng chỉ cần nhập mã 4-8 chữ số.</p>

            <div className="ttd-switch-row">
              <div className="ttd-switch-meta">
                <Smartphone className={`w-5 h-5 ${isKeepAliveEnabled ? 'ttd-pulse' : ''}`} />
                <div>
                  <p>Keep Alive cho mobile</p>
                  <small>Giữ tab nền hoạt động ổn định hơn</small>
                </div>
              </div>
              <label className="ttd-switch">
                <input type="checkbox" checked={isKeepAliveEnabled} onChange={e => setIsKeepAliveEnabled(e.target.checked)} />
                <span />
              </label>
            </div>

            <div className="ttd-status-line">{isConnected ? 'Đã kết nối' : 'Chưa kết nối'}</div>
            <button onClick={toggleConnection} className={`ttd-btn ttd-w-full ${isConnected ? 'ttd-btn-danger' : 'ttd-btn-primary'}`}>
              {isConnected ? <><Square className="w-4 h-4" /> Ngắt kết nối</> : <><Play className="w-4 h-4" /> Kết nối ngay</>}
            </button>
          </div>

          <div className="ttd-card reveal-2">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="ttd-card-title"><Shield className="w-5 h-5" /> Kho tài khoản</h2>
              <div className="flex gap-2">
                <label className="ttd-btn ttd-btn-ghost">
                  <Upload className="w-4 h-4" /> Nhập tệp JSON
                  <input type="file" multiple accept=".json" className="hidden" onChange={handleFileUpload} />
                </label>
                <button onClick={() => setShowOAuthModal(true)} className="ttd-btn ttd-btn-secondary">
                  <Key className="w-4 h-4" /> OAuth
                </button>
              </div>
            </div>

            <div className="ttd-switch-row mb-4">
              <div className="ttd-switch-meta">
                <RefreshCw className="w-5 h-5" />
                <div>
                  <p>Auto Refresh Token</p>
                  <small>Tự làm mới phiên đăng nhập trước khi hết hạn</small>
                </div>
              </div>
              <label className="ttd-switch">
                <input type="checkbox" checked={isAutoRefreshEnabled} onChange={e => setIsAutoRefreshEnabled(e.target.checked)} />
                <span />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {credentials.map(cred => (
                <div key={cred.id} className="ttd-cred">
                  <button onClick={() => setCredentials(prev => prev.filter(c => c.id !== cred.id))} className="ttd-trash">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="ttd-cred-title">
                    <span className={`ttd-dot ${
                      cred.status === 'Ready' ? 'ready' :
                      ['In Use', 'Refreshing'].includes(cred.status) ? 'busy' : 'bad'
                    }`} />
                    <strong>{cred.email || cred.project_id || 'Chưa xác định'}</strong>
                  </div>
                  <p>Trạng thái: {cred.status}</p>
                  <p>Đã dùng: {cred.requestsUsed} lượt</p>
                  <p className="truncate" title={cred.client_id}>Client: {cred.client_id}</p>
                </div>
              ))}
              {credentials.length === 0 && (
                <div className="ttd-empty">Chưa có tài khoản nào. Bạn có thể nhập tệp JSON hoặc đăng nhập OAuth.</div>
              )}
            </div>
          </div>
        </div>

        <div className="ttd-console reveal-3">
          <h2 className="ttd-card-title"><Terminal className="w-5 h-5" /> Nhật ký hệ thống</h2>
          <div className="ttd-log-list">
            {logs.map((log, i) => (
              <div key={i} className={`ttd-log ${log.type}`}>
                <span>[{log.time.toLocaleTimeString()}]</span>
                <span className="break-all">{log.msg}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {showOAuthModal && <OAuthModal onClose={() => setShowOAuthModal(false)} onAddCredential={c => setCredentials(prev => [...prev, c])} />}
      {showGuide && <GuideModal onClose={() => setShowGuide(false)} />}
    </div>
  );
};

const OAuthCallbackPage = () => {
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    const state = url.searchParams.get('state');

    if (window.opener) {
      window.opener.postMessage({ type: 'oauth_callback', code, error, state }, window.location.origin);
      window.close();
    }
  }, []);

  return (
    <div className="ttd-shell min-h-screen flex items-center justify-center p-6">
      <div className="ttd-modal text-center">
        <p className="ttd-subtitle mb-2">Đang xử lý đăng nhập Google...</p>
        <p className="ttd-muted">Bạn có thể đóng cửa sổ này nếu nó không tự động đóng.</p>
      </div>
    </div>
  );
};

const urlParams = new URLSearchParams(window.location.search);
const isOAuthPopupCallback =
  !!window.opener &&
  urlParams.has('state') &&
  (urlParams.has('code') || urlParams.has('error'));
const RootComponent = isOAuthPopupCallback ? OAuthCallbackPage : App;

createRoot(document.getElementById('root')!).render(<RootComponent />);

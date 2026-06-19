// usePush — manage Web Push subscription for the parent portal.
//
// Exposes the current permission/subscription state plus subscribe/unsubscribe
// actions. Works on Android + desktop always; on iOS only when the app has been
// added to the Home Screen (installed PWA, iOS 16.4+). Gracefully no-ops where
// the Push API is unavailable so callers can hide the UI.

import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

// VAPID public keys are URL-safe base64 — PushManager wants a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isSupported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export default function usePush(pushBase = '/portal') {
  // Normalize: no trailing slash. Parent → '/portal', admin → '/notifications'.
  const base = String(pushBase).replace(/\/+$/, '');
  const [permission, setPermission] = useState(
    isSupported ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reflect any existing subscription on mount.
  useEffect(() => {
    if (!isSupported) return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setSubscribed(!!sub);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported || busy) return false;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;
      const { key } = await api.get(`${base}/push/vapid-key`);
      if (!key) return false;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
      }
      const json = sub.toJSON();
      await api.post(`${base}/push/subscribe`, {
        endpoint: json.endpoint,
        keys: json.keys,
      });
      setSubscribed(true);
      return true;
    } catch (err) {
      console.error('[usePush] subscribe failed', err);
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, base]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported || busy) return false;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe().catch(() => {});
        await api.post(`${base}/push/unsubscribe`, { endpoint }).catch(() => {});
      }
      setSubscribed(false);
      return true;
    } catch (err) {
      console.error('[usePush] unsubscribe failed', err);
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, base]);

  return { isSupported, permission, subscribed, busy, subscribe, unsubscribe };
}

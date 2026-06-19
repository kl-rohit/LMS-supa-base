// Tiny PWA install helper.
//
// Chrome/Edge/Android fire `beforeinstallprompt` which we capture so we can
// surface our own "Install" button and call prompt() on demand. iOS Safari
// has NO such event — the only path is Share → Add to Home Screen — so we
// detect iOS and let the UI show manual instructions instead.
//
// `installed` is true when the page is already running as an installed PWA
// (display-mode: standalone, or navigator.standalone on iOS), in which case
// there's nothing to prompt.

import { useCallback, useEffect, useState } from 'react';

function detectStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator?.standalone === true
  );
}

function detectIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isiOS = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac; sniff touch support to catch it.
  const isiPadOS = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return isiOS || isiPadOS;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(detectStandalone());
  const isIOS = detectIOS();

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();          // stop Chrome's mini-infobar
      setDeferredPrompt(e);        // stash for our own button
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // Some browsers flip display-mode without firing appinstalled — watch it.
    const mq = window.matchMedia?.('(display-mode: standalone)');
    const onChange = (e) => setInstalled(e.matches);
    mq?.addEventListener?.('change', onChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      mq?.removeEventListener?.('change', onChange);
    };
  }, []);

  // Trigger the native install prompt. Returns the user's choice ('accepted'
  // | 'dismissed' | null when no prompt was available).
  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return null;
    deferredPrompt.prompt();
    try {
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      setDeferredPrompt(null);
      return outcome;
    } catch {
      return null;
    }
  }, [deferredPrompt]);

  return {
    installed,                       // already running as an installed app
    isIOS,                           // needs manual Add-to-Home-Screen steps
    canPrompt: !!deferredPrompt,     // native install button can be shown
    promptInstall,
  };
}

export default usePwaInstall;

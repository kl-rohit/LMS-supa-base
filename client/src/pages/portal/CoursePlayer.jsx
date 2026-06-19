// Parent portal: Udemy-style course player with FULLY CUSTOM controls.
//
// We use YouTube's IFrame Player API but set controls=0 so YouTube renders
// NO UI inside the player — no play button, no seek bar, no settings cog,
// no share button. We build our own controls on top and drive the player via
// player.playVideo() / pauseVideo() / seekTo() / etc.
//
// This is the only way to prevent YouTube's share / "copy link" surfaces
// from showing up.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, PlayCircle, Lock, Play, Pause, Maximize2, Minimize2,
  Volume2, VolumeX, List, ChevronRight, ChevronLeft, ListChecks,
  PanelRightClose, PanelRightOpen, SkipForward, FileText, Award, Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../utils/api';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';
import LessonQuiz from '../../components/LessonQuiz';
import { downloadCertificate } from '../../utils/certificate';
import { extractYouTubeId, ytThumbnail, formatDuration, parseChapters, currentChapterIndex, driveEmbedUrl } from '../../utils/youtube';

const UI_TICK_MS = 500;
let YT_SCRIPT_LOADED = false;

// iOS (incl. iPadOS, which masquerades as Mac) can't put a <div>/<iframe> into
// native fullscreen — only a bare <video> — and in a standalone PWA the
// Fullscreen API is unavailable entirely. On those we must use CSS
// pseudo-fullscreen, NOT the native API (which silently no-ops there).
const IS_IOS = typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

function nativeFullscreenSupported(el) {
  if (IS_IOS) return false;
  if (typeof document === 'undefined') return false;
  const enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
  return !!enabled && !!(el && (el.requestFullscreen || el.webkitRequestFullscreen));
}

// Final-save URL: sendBeacon needs the absolute API path because the beacon
// fires after React has unmounted. PUBLIC_URL on Catalyst = '/app/', so
// the API base is '/server/api/api'; in local dev fall back to '/api'.
function progressBeaconUrl(lessonId) {
  const isCatalyst = (process.env.PUBLIC_URL || '/') !== '/';
  const base = isCatalyst ? '/server/api/api' : '/api';
  return `${base}/portal/lessons/${lessonId}/progress`;
}

function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const existing = window._ytReadyCallbacks || [];
    window._ytReadyCallbacks = [...existing, resolve];
    if (YT_SCRIPT_LOADED) return;
    YT_SCRIPT_LOADED = true;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    const prevHandler = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevHandler?.();
      (window._ytReadyCallbacks || []).forEach((cb) => cb());
      window._ytReadyCallbacks = [];
    };
  });
}

export default function CoursePlayer() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [course, setCourse] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [currentLessonId, setCurrentLessonId] = useState(null);

  // Player state (driven by IFrame API events + ticker)
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // iOS Safari cannot put a <div>/<iframe> into native fullscreen (only <video>),
  // so the embedded YouTube player can't go native-fullscreen there. Fall back to
  // a CSS "pseudo-fullscreen" that pins the player over the viewport.
  const [pseudoFs, setPseudoFs] = useState(false);
  // Track orientation so pseudo-fullscreen can rotate-to-landscape on a
  // portrait phone (iframes can't go native-fullscreen on iOS).
  const [isPortrait, setIsPortrait] = useState(
    typeof window !== 'undefined' ? window.innerHeight >= window.innerWidth : false
  );
  // Playback speed (YouTube IFrame API supports 0.25 / 0.5 / 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2)
  // Music-relevant choices: 0.5x for slow-along practice, 1.25/1.5x for review.
  const [playbackRate, setPlaybackRate] = useState(1);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  // Touch devices have no :hover, so the controls bar (which used group-hover)
  // was invisible/unreachable on phones. Reveal it on tap + auto-hide while
  // playing.
  const [showControls, setShowControls] = useState(false);
  const controlsHideRef = useRef(null);
  // Udemy-style "Next lesson" overlay — shown after the video ends or when a
  // completed lesson is paused.
  const [showNextOverlay, setShowNextOverlay] = useState(false);
  // Certificate download in flight (fetch eligibility + lazy-load jsPDF).
  const [certBusy, setCertBusy] = useState(false);

  const playerRef = useRef(null);
  const uiTickRef = useRef(null);
  const playerWrapperRef = useRef(null);
  // Stable React-managed wrapper for the YT iframe. We programmatically
  // append a fresh child div inside it before each YT.Player mount, so
  // YT's "replace the element with an iframe" behavior never touches a
  // node that React is tracking — preventing removeChild conflicts on
  // unmount / lesson-type switch.
  const ytContainerRef = useRef(null);
  // Guards the brief window after Replay so the next UI tick doesn't see
  // t >= chapEnd (player hasn't finished the seek yet) and re-show overlay.
  const replayGuardUntilRef = useRef(0);

  // Keep the latest lesson id in a ref so the beforeunload handler always has it.
  const currentLessonIdRef = useRef(null);
  useEffect(() => { currentLessonIdRef.current = currentLessonId; }, [currentLessonId]);

  // ----- Preload the YouTube IFrame API on mount -----
  // The API script (~50KB) used to only start downloading once the player
  // mounted — i.e. AFTER the course fetch resolved. Kicking it off here lets the
  // script download in parallel with the lessons fetch, so the player is ready
  // sooner and the "loading…" gap shrinks noticeably.
  useEffect(() => { loadYouTubeAPI(); }, []);

  // ----- Initial load -----
  useEffect(() => {
    (async () => {
      try {
        const data = await api.get(`/portal/courses/${courseId}/lessons`);
        setCourse(data.course);
        setLessons(data.lessons || []);
        const firstIncomplete = (data.lessons || []).find((l) => !l.progress?.completed);
        const target = firstIncomplete || (data.lessons || [])[0];
        if (target) setCurrentLessonId(target.id);
      } catch (err) { /* enrollment/404 falls through */ }
      finally { setLoading(false); }
    })();
  }, [courseId]);

  // ----- Save progress -----
  const saveProgress = async (lessonId) => {
    if (!playerRef.current || !lessonId) return;
    try {
      const watched = Math.floor(playerRef.current.getCurrentTime?.() || 0);
      const dur = Math.floor(playerRef.current.getDuration?.() || 0);
      if (watched <= 0) return;
      const resp = await api.post(`/portal/lessons/${lessonId}/progress`, {
        watched_seconds: watched,
        duration_seconds: dur,
      });
      setLessons((prev) => prev.map((l) => l.id === lessonId ? { ...l, progress: resp.progress } : l));
    } catch {}
  };

  // ----- UI tick: keep seek bar in sync while playing -----
  // Overlay appears ONLY at 100% completion:
  //   • Full-video lessons → the YouTube ENDED state fires naturally (handled
  //     in onStateChange). No pre-empt; the video plays through.
  //   • Chapter-lessons (end_seconds > 0) → the underlying video keeps going
  //     past the chapter end, so we DO have to pause here when t reaches
  //     end_seconds. But no early pre-empt — pause exactly at the chapter end.
  useEffect(() => {
    clearInterval(uiTickRef.current);
    if (isPlaying) {
      uiTickRef.current = setInterval(() => {
        if (!playerRef.current) return;
        try {
          const t = playerRef.current.getCurrentTime?.() || 0;
          const dur = playerRef.current.getDuration?.() || 0;
          setCurrentTime(t);
          if (dur > 0) setDuration(dur);

          // Only intervene for chapter-lessons. Full-video lessons play to
          // the natural ENDED state — no pause from us.
          const lesson = lessons.find((l) => l.id === currentLessonId);
          const chapEnd = Number(lesson?.end_seconds) || 0;
          if (chapEnd > 0 && t >= chapEnd) {
            // Skip the trigger briefly after a Replay — the player's reported
            // time can lag the seek by a few hundred ms, causing the overlay
            // to immediately re-appear right after dismissing it.
            if (Date.now() < replayGuardUntilRef.current) return;
            try { playerRef.current.pauseVideo(); } catch {}
            setShowNextOverlay(true);
          }
        } catch {}
      }, UI_TICK_MS);
    }
    return () => clearInterval(uiTickRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentLessonId]);

  // ----- Mount player on lesson change -----
  useEffect(() => {
    if (!currentLessonId) return;
    const lesson = lessons.find((l) => l.id === currentLessonId);
    if (!lesson) return;
    // Document & quiz lessons don't use the YT player at all
    if (lesson.content_type === 'document' || lesson.content_type === 'quiz') {
      setShowNextOverlay(false);
      return;
    }
    const ytId = extractYouTubeId(lesson.video_url);
    if (!ytId) return;

    let mounted = true;
    // For chapter-as-lesson (start_seconds > 0), resume from the saved
    // position if it's inside the segment; otherwise start at the segment's
    // start. This way a fresh lesson starts at start_seconds, not 0.
    const lessonStart = Number(lesson.start_seconds) || 0;
    const lessonEnd   = Number(lesson.end_seconds) || 0;
    const savedPos    = Number(lesson.progress?.watched_seconds) || 0;
    const inSegment   = savedPos > lessonStart && (lessonEnd === 0 || savedPos < lessonEnd);
    const startAt     = inSegment ? savedPos : lessonStart;
    setIsPlaying(false);
    setCurrentTime(startAt);
    setDuration(Number(lesson.duration_seconds) || 0);
    setShowNextOverlay(false); // hide overlay when switching lessons

    (async () => {
      await loadYouTubeAPI();
      if (!mounted) return;

      try { playerRef.current?.destroy?.(); } catch {}
      playerRef.current = null;

      // Wait for the wrapper to be mounted in DOM
      if (!ytContainerRef.current) return;

      // YT.Player REPLACES the target element with an iframe. We can't let it
      // replace a React-managed node. So create a throwaway child div inside
      // our wrapper, and pass that to YT. After destroy() the throwaway is
      // gone; React's wrapper stays intact for the next mount.
      // Clear any leftover children from a previous mount first.
      while (ytContainerRef.current.firstChild) {
        ytContainerRef.current.removeChild(ytContainerRef.current.firstChild);
      }
      const target = document.createElement('div');
      target.style.width = '100%';
      target.style.height = '100%';
      ytContainerRef.current.appendChild(target);

      playerRef.current = new window.YT.Player(target, {
        videoId: ytId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: {
          controls: 0,            // ← HIDE YouTube's UI entirely
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          disablekb: 1,
          playsinline: 1,
          cc_load_policy: 0,
          fs: 0,                  // hide YT fullscreen button (we have our own)
          start: startAt,
        },
        events: {
          onReady: (event) => {
            if (startAt > 0) {
              try { event.target.seekTo(startAt, true); } catch {}
            }
            // Preserve playback speed across lessons
            try { event.target.setPlaybackRate(playbackRate); } catch {}
            try { setDuration(event.target.getDuration?.() || 0); } catch {}
          },
          onStateChange: async (event) => {
            const YT = window.YT?.PlayerState;
            if (event.data === YT?.PLAYING) {
              setIsPlaying(true);
              setShowNextOverlay(false);
            } else {
              setIsPlaying(false);
              // Save on pause / ended only. No heartbeat while playing —
              // beforeunload + lesson switch + component unmount cover the rest.
              if (event.data === YT?.PAUSED || event.data === YT?.ENDED) {
                await saveProgress(currentLessonId);
                // Show the "Next lesson" overlay if the video ended OR if the
                // lesson is already at ≥90% complete. Refreshed via saveProgress.
                if (event.data === YT?.ENDED) {
                  setShowNextOverlay(true);
                }
              }
            }
          },
        },
      });
    })();

    return () => {
      mounted = false;
      saveProgress(currentLessonId);
      clearInterval(uiTickRef.current);
      uiTickRef.current = null;
      try { playerRef.current?.destroy?.(); } catch {}
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLessonId]);

  // ----- Fullscreen handling -----
  useEffect(() => {
    const onChange = () => {
      const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(active);
      // Whenever we leave native fullscreen by ANY route (our button, Escape,
      // the Android system back gesture), drop the landscape lock so the page
      // returns to its normal portrait orientation.
      if (!active) {
        try { window.screen?.orientation?.unlock?.(); } catch {}
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      // Safety net: release any lingering lock if the player unmounts mid-FS.
      try { window.screen?.orientation?.unlock?.(); } catch {}
    };
  }, []);

  // ----- CSS pseudo-fullscreen (iOS / PWA fallback) -----
  // Lock body scroll while pinned over the viewport, let Escape exit, and
  // track orientation so we can rotate-to-landscape on a portrait phone.
  useEffect(() => {
    if (!pseudoFs) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setPseudoFs(false); };
    const onResize = () => setIsPortrait(window.innerHeight >= window.innerWidth);
    onResize();
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [pseudoFs]);

  // ----- Keyboard shortcuts -----
  // Spacebar = play/pause
  // ←/→ = seek -5s / +5s
  // f = fullscreen toggle
  // m = mute toggle
  useEffect(() => {
    const onKey = (e) => {
      // Skip if user is typing in an input/textarea/contenteditable
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (!playerRef.current) return;

      switch (e.key) {
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          // Read live state from the player (not React state) for accuracy
          try {
            const state = playerRef.current.getPlayerState?.();
            if (state === window.YT?.PlayerState?.PLAYING) playerRef.current.pauseVideo();
            else playerRef.current.playVideo();
          } catch {}
          break;
        case 'ArrowLeft':
          e.preventDefault();
          try {
            const t = playerRef.current.getCurrentTime?.() || 0;
            seekTo(Math.max(0, t - 5));
          } catch {}
          break;
        case 'ArrowRight':
          e.preventDefault();
          try {
            const t = playerRef.current.getCurrentTime?.() || 0;
            seekTo(t + 5);
          } catch {}
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Save on tab close / browser crash via sendBeacon -----
  // pagehide fires on tab close, navigation, and (modern browsers) bfcache.
  // beforeunload fires on close/reload. We listen to both for max coverage.
  // sendBeacon is fire-and-forget — survives the page going away.
  useEffect(() => {
    const onUnload = () => {
      const lessonId = currentLessonIdRef.current;
      if (!lessonId || !playerRef.current) return;
      try {
        const watched = Math.floor(playerRef.current.getCurrentTime?.() || 0);
        const dur = Math.floor(playerRef.current.getDuration?.() || 0);
        if (watched <= 0) return;
        const body = JSON.stringify({ watched_seconds: watched, duration_seconds: dur });
        const blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon?.(progressBeaconUrl(lessonId), blob);
      } catch {}
    };
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  // ----- Document lesson: mark as "opened" (50%) on first view -----
  // Placed here (before any early returns) to satisfy the rules of hooks.
  useEffect(() => {
    const lesson = lessons.find((l) => l.id === currentLessonId);
    if (!lesson || lesson.content_type !== 'document') return;
    if (lesson.progress?.completed) return;
    if ((lesson.progress?.percent_complete || 0) >= 50) return;
    let cancelled = false;
    api.post(`/portal/lessons/${lesson.id}/progress`, { watched_seconds: 1, duration_seconds: 100 })
      .then((resp) => {
        if (cancelled) return;
        setLessons((prev) => prev.map((l) => l.id === lesson.id ? { ...l, progress: resp.progress } : l));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [currentLessonId, lessons]);

  // Reveal the controls bar (touch tap) and auto-hide after a few seconds
  // while playing. Paused video keeps controls visible.
  const revealControls = () => {
    setShowControls(true);
    clearTimeout(controlsHideRef.current);
    controlsHideRef.current = setTimeout(() => {
      try { if (playerRef.current?.getPlayerState?.() === window.YT?.PlayerState?.PLAYING) setShowControls(false); } catch {}
    }, 3500);
  };
  useEffect(() => () => clearTimeout(controlsHideRef.current), []);

  const togglePlay = () => {
    revealControls();
    if (!playerRef.current) return;
    try {
      if (isPlaying) playerRef.current.pauseVideo();
      else playerRef.current.playVideo();
    } catch {}
  };

  const toggleMute = () => {
    if (!playerRef.current) return;
    try {
      if (isMuted) { playerRef.current.unMute(); setIsMuted(false); }
      else { playerRef.current.mute(); setIsMuted(true); }
    } catch {}
  };

  const toggleFullscreen = async () => {
    const el = playerWrapperRef.current;
    if (!el) return;
    revealControls();
    // If we're in CSS pseudo-fullscreen (iOS / PWA), just toggle it back off.
    if (pseudoFs) { setPseudoFs(false); return; }
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      // Release the landscape lock first (some engines ignore unlock once the
      // fullscreen element is gone), then exit.
      try { window.screen?.orientation?.unlock?.(); } catch {}
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } catch {}
      return;
    }
    // iOS Safari / standalone PWA can't fullscreen a <div>/<iframe> (only a
    // bare <video>), and the native API there silently no-ops — so the old
    // `await el.requestFullscreen()` resolved without entering fullscreen and
    // the button appeared to "do nothing". Go straight to the CSS pin there.
    if (!nativeFullscreenSupported(el)) { setPseudoFs(true); return; }
    // Desktop / Android Chrome: use the real Fullscreen API.
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch { setPseudoFs(true); return; }
    // Android Chrome fullscreens the <div> but does NOT rotate the device, so a
    // 16:9 video just letterboxes in portrait. Lock the orientation to
    // landscape now that we're in fullscreen (the API requires it). This is the
    // native equivalent of the iOS CSS rotate hack. Throws / rejects on desktop
    // and where unsupported — swallow it (desktop fullscreen is fine as-is).
    try {
      const p = window.screen?.orientation?.lock?.('landscape');
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {}
    // Some engines resolve requestFullscreen() without actually entering
    // fullscreen — verify on the next frame and fall back to the CSS pin.
    setTimeout(() => {
      const active = document.fullscreenElement || document.webkitFullscreenElement;
      if (!active) setPseudoFs(true);
    }, 200);
  };

  const seekTo = (seconds) => {
    if (!playerRef.current) return;
    try {
      playerRef.current.seekTo(seconds, true);
      setCurrentTime(seconds);
    } catch {}
  };

  const changeSpeed = (rate) => {
    if (!playerRef.current) return;
    try {
      playerRef.current.setPlaybackRate(rate);
      setPlaybackRate(rate);
    } catch {}
    setSpeedMenuOpen(false);
  };

  // ----- Render -----
  if (loading) return <Loader />;
  if (!course) {
    return (
      <EmptyState
        icon={Lock}
        title="Course not available"
        message="You may not be enrolled in this course. Contact your teacher."
      />
    );
  }

  const currentLesson = lessons.find((l) => l.id === currentLessonId);
  const isQuizLesson = currentLesson?.content_type === 'quiz';
  const isDocLesson = currentLesson?.content_type === 'document';
  const currentYtId = currentLesson && !isDocLesson && !isQuizLesson ? extractYouTubeId(currentLesson.video_url) : null;
  const docEmbedUrl = isDocLesson ? driveEmbedUrl(currentLesson.content_url) : null;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Pseudo-fullscreen sizing. On a portrait phone we rotate the whole stage
  // 90° so the 16:9 video fills the screen in landscape — iframes can't go
  // native-fullscreen on iOS / in a PWA, so this is the reliable path there.
  // Landscape (or desktop native FS) just fills while preserving 16:9.
  const rotatedFs = pseudoFs && isPortrait;
  const stageStyle = rotatedFs
    ? {
        position: 'fixed',
        top: '50%',
        left: '50%',
        width: '100vh',
        height: '100vw',
        transform: 'translate(-50%, -50%) rotate(90deg)',
        transformOrigin: 'center center',
      }
    : (isFullscreen || pseudoFs)
    ? {
        width: 'min(100vw, 177.78vh)',
        height: 'min(100vh, 56.25vw)',
        maxWidth: '100vw',
        maxHeight: '100vh',
      }
    : undefined;

  // Chapters parsed from the lesson description (YouTube-style timestamps).
  const chapters = parseChapters(currentLesson?.description);
  const activeChapterIdx = currentChapterIndex(chapters, currentTime);

  const jumpToChapter = (idx) => {
    if (idx < 0 || idx >= chapters.length) return;
    seekTo(chapters[idx].start);
    try { playerRef.current?.playVideo?.(); } catch {}
  };

  // Next-lesson navigation: pick the lesson that comes after the current one
  // in the sidebar order.
  const currentIdx = lessons.findIndex((l) => l.id === currentLessonId);
  const nextLesson = currentIdx >= 0 && currentIdx < lessons.length - 1
    ? lessons[currentIdx + 1] : null;
  const isCurrentComplete = currentLesson?.progress?.completed ||
    (currentLesson?.progress?.percent_complete || 0) >= 90;

  const goToNextLesson = () => {
    if (nextLesson) setCurrentLessonId(nextLesson.id);
  };

  // Quiz passed → flip quiz_passed locally so completion gates + the sidebar
  // update immediately without a refetch.
  const handleQuizPassed = (lessonId) => {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, quiz_passed: true } : l)));
  };

  // Whether a lesson counts as "done" for course completion + the certificate.
  // Mirrors the backend's lessonFullyDone (routes/portal.js):
  //   • content lesson (video/document) → progress.completed
  //   • quiz lesson with no questions → done (nothing to do)
  //   • optional quiz lesson → done regardless (students may skip it)
  //   • required quiz lesson → done only once passed
  const lessonDone = (l) => {
    if ((l.content_type || 'video') === 'quiz') {
      if (!l.has_quiz) return true;
      return l.quiz_required ? !!l.quiz_passed : true;
    }
    return !!l.progress?.completed;
  };

  // Course is fully complete when every lesson is done. Gates the certificate.
  const allCourseComplete = lessons.length > 0 && lessons.every(lessonDone);

  const downloadCert = async () => {
    setCertBusy(true);
    try {
      const data = await api.get(`/portal/courses/${courseId}/certificate`);
      await downloadCertificate(data.certificate);
    } catch (err) {
      const remaining = err?.response?.data?.remaining;
      if (remaining > 0) {
        toast.error(`Finish all lessons first — ${remaining} to go.`);
      } else {
        toast.error(err?.response?.data?.error || 'Could not generate certificate');
      }
    } finally {
      setCertBusy(false);
    }
  };

  // "Mark as completed" for the active document lesson.
  const markDocCompleted = async () => {
    const lesson = lessons.find((l) => l.id === currentLessonId);
    if (!lesson || lesson.content_type !== 'document') return;
    try {
      const resp = await api.post(`/portal/lessons/${lesson.id}/progress`, { completed: true });
      setLessons((prev) => prev.map((l) => l.id === lesson.id ? { ...l, progress: resp.progress } : l));
    } catch (err) {
      // surface error via toast? keep silent for now
    }
  };

  return (
    <div className="space-y-4">
      {/* Pseudo-fullscreen chrome rendered straight to <body> via a portal.
          This escapes the parent portal's scrolling <main> (and any ancestor
          stacking context), so a full-viewport black backdrop reliably masks
          the app header/sidebar — fixing the "header showing on the left"
          sliver — and the single exit button sits at the TRUE screen corner
          regardless of the rotate-to-landscape transform on the video stage. */}
      {pseudoFs && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 bg-black z-[55]" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setPseudoFs(false)}
            className="fixed z-[70] p-2.5 rounded-full bg-black/60 text-white hover:bg-black/80 active:scale-95"
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
              right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
            }}
            aria-label="Exit fullscreen"
          >
            <Minimize2 className="w-5 h-5" />
          </button>
        </>,
        document.body,
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => navigate('/portal/lessons')} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{course.name}</h2>
          {currentLesson && <p className="text-xs text-gray-500 truncate">{currentLesson.title}</p>}
        </div>
        {allCourseComplete && (
          <button
            onClick={downloadCert}
            disabled={certBusy}
            className="btn-primary btn-sm flex-shrink-0 disabled:opacity-50"
            title="Download your course completion certificate"
          >
            {certBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
            <span className="hidden sm:inline">Certificate</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Player + custom controls — takes 3/4 of the row on desktop */}
        <div className="lg:col-span-3 space-y-3">
          {/* Quiz lessons render the quiz as the main content (no video frame). */}
          {isQuizLesson && currentLesson && (
            <LessonQuiz
              key={currentLesson.id}
              lesson={currentLesson}
              lessonId={currentLesson.id}
              onPassed={handleQuizPassed}
              nextLesson={nextLesson}
              onNext={goToNextLesson}
            />
          )}

          {!isQuizLesson && (
          <>
          <div
            ref={playerWrapperRef}
            className={`card p-0 overflow-hidden ${isDocLesson ? 'bg-gray-100' : 'bg-black'} relative group select-none ${
              (isFullscreen || pseudoFs) ? 'flex items-center justify-center !rounded-none border-none' : ''
            } ${pseudoFs ? 'fixed inset-0 z-[60] !bg-black' : ''}`}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* Document iframe — only when current lesson is a doc with a valid URL */}
            {isDocLesson && docEmbedUrl && (
              <div className="w-full bg-white" style={{ height: '75vh' }}>
                <iframe
                  src={docEmbedUrl}
                  className="w-full h-full border-0"
                  title={currentLesson.title}
                  allow="autoplay; fullscreen"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            )}
            {isDocLesson && !docEmbedUrl && (
              <div className="aspect-video flex items-center justify-center text-gray-400 text-sm flex-col gap-2">
                <FileText className="w-10 h-10" />
                <p>Couldn't load this document. Check the Drive URL format.</p>
              </div>
            )}
            {/* YT player block — always mounted (hidden when showing a doc).
                This prevents React vs YouTube IFrame API fighting over the
                same DOM node during lesson-type switches. */}
            {!isDocLesson && currentYtId ? (
              <div
                className={`relative ${rotatedFs ? '' : 'aspect-video w-full'}`}
                style={stageStyle}
              >
                <div ref={ytContainerRef} className="w-full h-full pointer-events-none" />

                {/* Tap the video: if controls are hidden (touch), first tap
                    just reveals them; otherwise toggle play/pause. */}
                <button
                  onClick={() => {
                    const visible = showControls || pseudoFs || isFullscreen || !isPlaying;
                    if (!visible) { revealControls(); return; }
                    togglePlay();
                  }}
                  onDoubleClick={toggleFullscreen}
                  className="absolute inset-0 z-10 w-full h-full cursor-pointer focus:outline-none"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  type="button"
                >
                  {!isPlaying && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Play className="w-16 h-16 text-white drop-shadow-lg" fill="white" />
                    </span>
                  )}
                </button>

                {/* Cover the bottom-right corner where the YouTube logo
                    watermark still appears even with controls=0 */}
                <div
                  className="absolute bottom-0 right-0 w-[100px] h-[36px] z-20 pointer-events-auto cursor-default"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                />

                {/* "Next lesson" overlay — Udemy style, no auto-advance */}
                {showNextOverlay && (
                  <div className="absolute inset-0 z-40 bg-black/70 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full text-center">
                      <div className="flex items-center justify-center mb-3">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center bg-green-100">
                          <CheckCircle2 className="w-6 h-6 text-green-600" />
                        </div>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">Lesson complete</h3>
                      {nextLesson ? (
                        <>
                          <p className="text-sm text-gray-500 mt-1">Next up:</p>
                          <p className="text-base font-medium text-gray-800 mt-1 mb-4">{nextLesson.title}</p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button
                              onClick={() => {
                                // Replay = seek to the lesson's start (not 0
                                // — chapter-lessons start mid-video). Guard
                                // the UI tick so it doesn't re-fire the
                                // overlay before the seek registers.
                                replayGuardUntilRef.current = Date.now() + 1500;
                                setShowNextOverlay(false);
                                const startAt = Number(currentLesson?.start_seconds) || 0;
                                seekTo(startAt);
                                try { playerRef.current?.playVideo?.(); } catch {}
                              }}
                              className="btn-secondary btn-sm flex-1 justify-center"
                            >
                              Replay
                            </button>
                            <button
                              onClick={() => { setShowNextOverlay(false); goToNextLesson(); }}
                              className="btn-primary btn-sm flex-1 justify-center"
                            >
                              <SkipForward className="w-4 h-4" /> Next lesson
                            </button>
                          </div>
                          <button
                            onClick={() => setShowNextOverlay(false)}
                            className="mt-3 text-xs text-gray-400 hover:text-gray-600"
                          >
                            Dismiss
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-gray-500 mt-2">You've finished this course! 🎉</p>
                          <button
                            onClick={() => { setShowNextOverlay(false); seekTo(0); try { playerRef.current?.playVideo?.(); } catch {} }}
                            className="btn-secondary btn-sm mt-4 w-full justify-center"
                          >
                            Replay
                          </button>
                          <button
                            onClick={() => navigate('/portal/lessons')}
                            className="btn-primary btn-sm mt-2 w-full justify-center"
                          >
                            Back to courses
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Custom controls bar — visible on hover (desktop), on tap
                    (touch, via showControls), and always while fullscreen. */}
                <div
                  className={`absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/80 to-transparent px-4 pt-8 pb-2 transition-opacity ${
                    (showControls || pseudoFs || isFullscreen || !isPlaying) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  style={pseudoFs ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)' } : undefined}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Seek bar */}
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="range"
                      min={0}
                      max={Math.max(duration, 1)}
                      step={1}
                      value={Math.floor(currentTime)}
                      onChange={(e) => seekTo(Number(e.target.value))}
                      className="flex-1 accent-indigo-500 cursor-pointer"
                    />
                  </div>
                  {/* Controls row */}
                  <div className="flex items-center gap-3 text-white text-sm">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                      className="p-1.5 rounded hover:bg-white/10"
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleMute(); }}
                      className="p-1.5 rounded hover:bg-white/10"
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                    >
                      {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                    <span className="font-mono text-xs whitespace-nowrap">
                      {formatDuration(currentTime)} / {formatDuration(duration)}
                    </span>
                    <div className="flex-1" />
                    {/* Playback speed picker */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSpeedMenuOpen((v) => !v); }}
                        className="px-2 py-1.5 rounded hover:bg-white/10 text-xs font-medium tabular-nums"
                        title="Playback speed"
                      >
                        {playbackRate}x
                      </button>
                      {speedMenuOpen && (
                        <div
                          className="absolute bottom-full right-0 mb-1 bg-black/90 rounded-lg shadow-lg py-1 min-w-[80px] z-50"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                            <button
                              key={r}
                              type="button"
                              onClick={() => changeSpeed(r)}
                              className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 tabular-nums ${
                                playbackRate === r ? 'text-indigo-400 font-semibold' : 'text-white'
                              }`}
                            >
                              {r}x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* While CSS-pinned (iOS/PWA) the dedicated floating exit
                        button is the single exit affordance — hide this one so
                        there aren't two exit icons on screen. */}
                    {!pseudoFs && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                        className="p-1.5 rounded hover:bg-white/10"
                        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                      >
                        {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : !isDocLesson ? (
              <div className="aspect-video flex items-center justify-center text-white text-sm">
                No video selected
              </div>
            ) : null}
          </div>

          {currentLesson && (
            <div className="card">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-gray-900">{currentLesson.title}</h3>
                {chapters.length > 1 && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => jumpToChapter(activeChapterIdx - 1)}
                      disabled={activeChapterIdx <= 0}
                      className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Previous chapter"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-gray-500 px-1">
                      {activeChapterIdx + 1}/{chapters.length}
                    </span>
                    <button
                      onClick={() => jumpToChapter(activeChapterIdx + 1)}
                      disabled={activeChapterIdx >= chapters.length - 1}
                      className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                      title="Next chapter"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              {currentLesson.description && (
                <p className="text-sm text-gray-500 mt-2 whitespace-pre-wrap">{currentLesson.description}</p>
              )}
              {currentLesson.progress && (
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                  <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${currentLesson.progress.completed ? 'bg-green-500' : 'bg-indigo-500'}`}
                      style={{ width: `${currentLesson.progress.percent_complete || 0}%` }}
                    />
                  </div>
                  <span>{currentLesson.progress.percent_complete || 0}%</span>
                  {currentLesson.progress.completed && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                </div>
              )}
              {/* Mark-as-completed for document lessons */}
              {isDocLesson && !currentLesson.progress?.completed && (
                <button
                  onClick={markDocCompleted}
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 rounded-lg transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Mark as completed
                </button>
              )}
              {isDocLesson && currentLesson.progress?.completed && (
                <div className="mt-3 px-3 py-2.5 rounded-lg bg-green-50 text-green-700 text-sm font-medium text-center flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Completed ✓
                  {nextLesson && (
                    <button onClick={goToNextLesson} className="ml-3 text-indigo-600 hover:text-indigo-800 underline">
                      Next lesson →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Chapters — parsed from the lesson description (YouTube timestamp format) */}
          {chapters.length > 0 && (
            <div className="card">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <List className="w-5 h-5 text-indigo-600" />
                Chapters
                <span className="text-sm text-gray-400 font-normal">({chapters.length})</span>
              </h3>
              <div className="space-y-1">
                {chapters.map((c, idx) => {
                  const active = idx === activeChapterIdx;
                  return (
                    <button
                      key={idx}
                      onClick={() => jumpToChapter(idx)}
                      className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                        active ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <span className={`font-mono text-xs flex-shrink-0 ${active ? 'text-indigo-600 font-semibold' : 'text-gray-400'}`}>
                        {formatDuration(c.start)}
                      </span>
                      <span className={`text-sm ${active ? 'font-medium' : ''} truncate flex-1`}>
                        {c.title}
                      </span>
                      {active && <Play className="w-3 h-3 text-indigo-600 flex-shrink-0" fill="currentColor" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          </>
          )}
          {/* end !isQuizLesson — video/document player, info card & chapters */}
        </div>

        {/* Lessons sidebar */}
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="font-semibold text-gray-900 text-sm">
              Lessons <span className="text-xs text-gray-400 font-normal">({lessons.length})</span>
            </h3>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {(() => {
              if (lessons.length === 0) {
                return (
                  <p className="text-center text-sm text-gray-400 py-8 px-4">
                    No lessons in this course yet.
                  </p>
                );
              }
              // Group by section_name preserving order
              const groups = [];
              const groupIndex = new Map();
              lessons.forEach((l) => {
                const key = l.section_name || '';
                if (!groupIndex.has(key)) {
                  groupIndex.set(key, groups.length);
                  groups.push({ name: key, lessons: [] });
                }
                groups[groupIndex.get(key)].lessons.push(l);
              });
              return groups.map((g, gIdx) => (
                <div key={gIdx}>
                  {g.name && (
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-600 uppercase tracking-wide flex items-center justify-between">
                      <span>{g.name}</span>
                      <span className="text-gray-400 normal-case font-medium">
                        {g.lessons.filter(lessonDone).length}/{g.lessons.length}
                      </span>
                    </div>
                  )}
                  <div className="divide-y divide-gray-100">
                    {g.lessons.map((l, idx) => {
                      const lpct = l.progress?.percent_complete || 0;
                      const done = lessonDone(l);
                      const active = l.id === currentLessonId;
                      // Display lesson duration: if it's a chapter, use segment length
                      let displayDur = Number(l.duration_seconds) || 0;
                      const segStart = Number(l.start_seconds) || 0;
                      const segEnd   = Number(l.end_seconds) || 0;
                      if (segEnd > 0) displayDur = segEnd - segStart;
                      const isDocItem = l.content_type === 'document';
                      const isQuizItem = l.content_type === 'quiz';
                      const ytId = (!isDocItem && !isQuizItem) ? extractYouTubeId(l.video_url) : null;
                      return (
                        <button
                          key={l.id}
                          onClick={() => setCurrentLessonId(l.id)}
                          className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${active ? 'bg-indigo-50' : ''}`}
                        >
                          <div className="flex items-start gap-3">
                            {/* Thumbnail with status icon overlay.
                                Hidden below sm — mobile shows just the
                                title for a cleaner list. */}
                            <div className="flex-shrink-0 relative hidden sm:block">
                              {ytId ? (
                                <img
                                  src={ytThumbnail(ytId, 'default')}
                                  alt=""
                                  className={`w-16 h-9 rounded object-cover ${active ? 'ring-2 ring-indigo-500' : ''}`}
                                  loading="lazy"
                                />
                              ) : isDocItem ? (
                                <div className={`w-16 h-9 rounded bg-blue-50 flex items-center justify-center ${active ? 'ring-2 ring-indigo-500' : ''}`}>
                                  <FileText className="w-5 h-5 text-blue-500" />
                                </div>
                              ) : isQuizItem ? (
                                <div className={`w-16 h-9 rounded bg-indigo-50 flex items-center justify-center ${active ? 'ring-2 ring-indigo-500' : ''}`}>
                                  <ListChecks className="w-5 h-5 text-indigo-500" />
                                </div>
                              ) : (
                                <div className="w-16 h-9 rounded bg-gray-100 flex items-center justify-center">
                                  <PlayCircle className="w-4 h-4 text-gray-300" />
                                </div>
                              )}
                              <div className="absolute -top-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                                {done ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                                ) : isQuizItem ? (
                                  <ListChecks className={`w-4 h-4 ${active ? 'text-indigo-600' : 'text-gray-300'}`} />
                                ) : (
                                  <PlayCircle className={`w-4 h-4 ${active ? 'text-indigo-600' : 'text-gray-300'}`} />
                                )}
                              </div>
                            </div>
                            {/* Compact status dot for mobile — replaces the thumbnail */}
                            <div className="sm:hidden flex-shrink-0 mt-1">
                              {done ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                              ) : isQuizItem ? (
                                <ListChecks className={`w-4 h-4 ${active ? 'text-indigo-600' : 'text-gray-300'}`} />
                              ) : (
                                <PlayCircle className={`w-4 h-4 ${active ? 'text-indigo-600' : 'text-gray-300'}`} />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-medium ${active ? 'text-indigo-700' : 'text-gray-800'} truncate`}>
                                {idx + 1}. {l.title}
                              </p>
                              <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                                {isQuizItem ? (
                                  <>
                                    <span className="inline-flex items-center gap-1 text-indigo-500 font-medium">
                                      <ListChecks className="w-3.5 h-3.5" /> Quiz
                                    </span>
                                    {l.quiz_passed ? (
                                      <span className="text-green-600">· Passed</span>
                                    ) : l.quiz_required ? (
                                      <span className="text-amber-600 font-medium">· Required</span>
                                    ) : (
                                      <span>· Optional</span>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {displayDur > 0 && <span>{formatDuration(displayDur)}</span>}
                                    {lpct > 0 && !done && <span>· {lpct}% watched</span>}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

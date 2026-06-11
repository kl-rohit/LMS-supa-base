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
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, PlayCircle, Lock, Play, Pause, Maximize2, Minimize2,
  Volume2, VolumeX, List, ChevronRight, ChevronLeft,
  PanelRightClose, PanelRightOpen, SkipForward,
} from 'lucide-react';
import api from '../../utils/api';
import Loader from '../../components/Loader';
import EmptyState from '../../components/EmptyState';
import { extractYouTubeId, formatDuration, parseChapters, currentChapterIndex } from '../../utils/youtube';

const UI_TICK_MS = 500;
let YT_SCRIPT_LOADED = false;

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
  // Udemy-style "Next lesson" overlay — shown after the video ends or when a
  // completed lesson is paused.
  const [showNextOverlay, setShowNextOverlay] = useState(false);

  const playerRef = useRef(null);
  const uiTickRef = useRef(null);
  const playerWrapperRef = useRef(null);
  const containerId = 'yt-player-container';

  // Keep the latest lesson id in a ref so the beforeunload handler always has it.
  const currentLessonIdRef = useRef(null);
  useEffect(() => { currentLessonIdRef.current = currentLessonId; }, [currentLessonId]);

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
  useEffect(() => {
    clearInterval(uiTickRef.current);
    if (isPlaying) {
      uiTickRef.current = setInterval(() => {
        if (!playerRef.current) return;
        try {
          setCurrentTime(playerRef.current.getCurrentTime?.() || 0);
          const dur = playerRef.current.getDuration?.() || 0;
          if (dur > 0) setDuration(dur);
        } catch {}
      }, UI_TICK_MS);
    }
    return () => clearInterval(uiTickRef.current);
  }, [isPlaying]);

  // ----- Mount player on lesson change -----
  useEffect(() => {
    if (!currentLessonId) return;
    const lesson = lessons.find((l) => l.id === currentLessonId);
    if (!lesson) return;
    const ytId = extractYouTubeId(lesson.video_url);
    if (!ytId) return;

    let mounted = true;
    const startAt = Number(lesson.progress?.watched_seconds) || 0;
    setIsPlaying(false);
    setCurrentTime(startAt);
    setDuration(Number(lesson.duration_seconds) || 0);
    setShowNextOverlay(false); // hide overlay when switching lessons

    (async () => {
      await loadYouTubeAPI();
      if (!mounted) return;

      try { playerRef.current?.destroy?.(); } catch {}
      playerRef.current = null;

      playerRef.current = new window.YT.Player(containerId, {
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
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

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

  const togglePlay = () => {
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
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      else await document.exitFullscreen();
    } catch {}
  };

  const seekTo = (seconds) => {
    if (!playerRef.current) return;
    try {
      playerRef.current.seekTo(seconds, true);
      setCurrentTime(seconds);
    } catch {}
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
  const currentYtId = currentLesson ? extractYouTubeId(currentLesson.video_url) : null;
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => navigate('/portal/lessons')} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{course.name}</h2>
          {currentLesson && <p className="text-xs text-gray-500 truncate">{currentLesson.title}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Player + custom controls — takes 3/4 of the row on desktop */}
        <div className="lg:col-span-3 space-y-3">
          <div
            ref={playerWrapperRef}
            className="card p-0 overflow-hidden bg-black relative group select-none"
            onContextMenu={(e) => e.preventDefault()}
          >
            {currentYtId ? (
              <div className="aspect-video w-full relative">
                <div id={containerId} className="w-full h-full pointer-events-none" />

                {/* Click anywhere on the video → play/pause */}
                <button
                  onClick={togglePlay}
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
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
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
                              onClick={() => { setShowNextOverlay(false); seekTo(0); try { playerRef.current?.playVideo?.(); } catch {} }}
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

                {/* Custom controls bar */}
                <div className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/80 to-transparent px-4 pt-8 pb-2 opacity-0 group-hover:opacity-100 transition-opacity">
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
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
                      className="p-1.5 rounded hover:bg-white/10"
                      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    >
                      {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="aspect-video flex items-center justify-center text-white text-sm">
                No video selected
              </div>
            )}
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
        </div>

        {/* Lessons sidebar */}
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="font-semibold text-gray-900 text-sm">
              Lessons <span className="text-xs text-gray-400 font-normal">({lessons.length})</span>
            </h3>
          </div>
          <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
            {lessons.map((l, idx) => {
              const lpct = l.progress?.percent_complete || 0;
              const done = l.progress?.completed;
              const active = l.id === currentLessonId;
              return (
                <button
                  key={l.id}
                  onClick={() => setCurrentLessonId(l.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${active ? 'bg-indigo-50' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {done ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : (
                        <PlayCircle className={`w-5 h-5 ${active ? 'text-indigo-600' : 'text-gray-300'}`} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${active ? 'text-indigo-700' : 'text-gray-800'} truncate`}>
                        {idx + 1}. {l.title}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                        {l.duration_seconds > 0 && <span>{formatDuration(l.duration_seconds)}</span>}
                        {lpct > 0 && !done && <span>· {lpct}% watched</span>}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {lessons.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8 px-4">
                No lessons in this course yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

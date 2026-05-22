// chat.jsx — open chat window. Supports two sizes:
//   size="large"   — full conversation, mode toggle as a segmented control
//   size="medium"  — peek card: just the latest assistant message + compact controls
// (The mini state is a separate Bubble component.)

const ChatWindow = ({
  pos, onClose, onDragEnd, onOpenSettings,
  theme, mode, setMode,
  voiceOn, setVoiceOn,
  sessionActive,
  messages, onSend,
  size, onShrink, onExpand,
}) => {
  const dragRef = React.useRef({ dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef(null);
  const isMedium = size === 'medium';

  function headerPointerDown(e) {
    if (e.target.closest('[data-no-drag]')) return;
    dragRef.current = { dragging: true, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function headerPointerMove(e) {
    const d = dragRef.current;
    if (!d.dragging) return;
    onDragEnd({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  }
  function headerPointerUp(e) {
    dragRef.current.dragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, size]);

  function handleSend() {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
  }

  // latest assistant message (skipping step entries)
  const latestAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

  const width = isMedium ? 360 : 380;
  const height = isMedium ? 196 : 560;

  return (
    <div style={{
      position: 'absolute',
      left: pos.x, top: pos.y,
      width, height,
      maxHeight: 'calc(100vh - 40px)',
      fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
    }}>
    {/* Ground bloom — bleeds warm color onto the desktop behind */}
    <div style={{
      position: 'absolute',
      left: -70, right: -70, top: -30, bottom: -90,
      background: `radial-gradient(ellipse at 50% 75%, ${theme.glowOuter} 0%, ${theme.glowOuterSoft} 35%, transparent 70%)`,
      filter: 'blur(24px)',
      pointerEvents: 'none',
      zIndex: 0,
      animation: 'sl-window-bloom 5.5s ease-in-out infinite',
    }} />

    {/* The window itself */}
    <div style={{
      position: 'relative',
      width: '100%', height: '100%',
      background: `
        radial-gradient(ellipse at 30% 0%, ${theme.windowTint} 0%, transparent 55%),
        radial-gradient(ellipse at 80% 100%, ${theme.glowOuterSoft} 0%, transparent 55%),
        ${theme.bg}
      `,
      color: theme.ink,
      borderRadius: 18,
      boxShadow: `
        0 0 0 1px rgba(244,232,218,0.06),
        0 0 40px 4px ${theme.glowOuterSoft},
        0 30px 80px rgba(0,0,0,0.55),
        inset 0 1px 0 rgba(255,255,255,0.06),
        inset 0 -1px 0 ${theme.glowOuterSoft}
      `,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 220ms cubic-bezier(0.3,0,0.2,1), height 220ms cubic-bezier(0.3,0,0.2,1)',
    }}>
    {/* Ambient internal lava — drifting warm blobs behind everything */}
    <div style={{
      position: 'absolute', inset: 0, overflow: 'hidden',
      pointerEvents: 'none', zIndex: 0,
      borderRadius: 18,
    }}>
      <div style={{
        position: 'absolute',
        width: 220, height: 220, borderRadius: '50%',
        left: '-20%', top: '40%',
        background: `radial-gradient(circle, ${theme.glowBgLava} 0%, ${theme.glowOuterSoft} 40%, transparent 75%)`,
        filter: 'blur(28px)',
        animation: 'sl-lava1 14s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute',
        width: 180, height: 180, borderRadius: '50%',
        right: '-15%', top: '-10%',
        background: `radial-gradient(circle, ${theme.glowOuter} 0%, ${theme.glowOuterSoft} 40%, transparent 75%)`,
        filter: 'blur(24px)',
        animation: 'sl-lava2 16s ease-in-out infinite',
      }} />
      {/* Specular highlight strip — glass surface */}
      <div style={{
        position: 'absolute', top: 0, left: 12, right: 12, height: 1,
        background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.18), transparent)',
      }} />
    </div>

    {/* Content layer — sits above the ambient */}
    <div style={{
      position: 'relative', zIndex: 1,
      display: 'flex', flexDirection: 'column',
      width: '100%', height: '100%',
    }}>
      {/* ── HEADER ─────────────────────────────────────── */}
      <div
        onPointerDown={headerPointerDown}
        onPointerMove={headerPointerMove}
        onPointerUp={headerPointerUp}
        style={{
          padding: isMedium ? '10px 10px 10px 12px' : '12px 12px 10px 14px',
          display: 'flex', flexDirection: 'column', gap: isMedium ? 0 : 10,
          background: theme.headerBg,
          borderBottom: '1px solid ' + theme.divider,
          cursor: 'grab', userSelect: 'none', touchAction: 'none',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 999,
            background: sessionActive ? theme.ok : theme.ink3,
            boxShadow: sessionActive ? '0 0 0 3px ' + theme.okSoft : 'none',
            transition: 'all 200ms',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '-0.01em' }}>SightLine</span>

          {/* In medium, mode toggle goes inline next to name */}
          {isMedium && (
            <div data-no-drag style={{ marginLeft: 4 }}>
              <ModePills mode={mode} setMode={setMode} theme={theme} />
            </div>
          )}

          {!isMedium && (
            <span style={{
              fontSize: 11, color: theme.ink3,
              fontFamily: 'Geist Mono, ui-monospace, monospace',
              marginLeft: 2,
            }}>
              {sessionActive ? (mode === 'live' ? 'watching · live' : 'watching') : 'ready'}
            </span>
          )}

          <div data-no-drag style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconBtn theme={theme} active={voiceOn} onClick={() => setVoiceOn(!voiceOn)} title={voiceOn ? 'Voice on' : 'Voice off'}>
              {voiceOn ? <SpeakerOnGlyph c={theme.accent} /> : <SpeakerOffGlyph c={theme.ink3} />}
            </IconBtn>
            <IconBtn theme={theme} onClick={onOpenSettings} title="Settings">
              <CogGlyph c={theme.ink2} />
            </IconBtn>
            {isMedium ? (
              <IconBtn theme={theme} onClick={onExpand} title="Expand">
                <ExpandGlyph c={theme.ink2} />
              </IconBtn>
            ) : (
              <IconBtn theme={theme} onClick={onShrink} title="Compact view">
                <ShrinkGlyph c={theme.ink2} />
              </IconBtn>
            )}
            <IconBtn theme={theme} onClick={onClose} title="Minimize">
              <MinimizeGlyph c={theme.ink2} />
            </IconBtn>
          </div>
        </div>

        {/* Large: mode segmented control under the header */}
        {!isMedium && (
          <div data-no-drag style={{
            display: 'flex',
            background: theme.segTrack,
            borderRadius: 10,
            padding: 3,
            position: 'relative',
            height: 32,
          }}>
            <div style={{
              position: 'absolute', top: 3, bottom: 3,
              left: mode === 'text' ? 3 : 'calc(50% + 1px)',
              width: 'calc(50% - 4px)',
              background: theme.segActive,
              borderRadius: 7,
              transition: 'left 220ms cubic-bezier(0.3,0,0.2,1)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }} />
            <button onClick={() => setMode('text')} style={segBtn(mode === 'text', theme)}>
              <MsgGlyph c={mode === 'text' ? theme.ink : theme.ink2} />
              Text
            </button>
            <button onClick={() => setMode('live')} style={segBtn(mode === 'live', theme)}>
              <EyeGlyph c={mode === 'live' ? theme.accent : theme.ink2} />
              Live
            </button>
          </div>
        )}
      </div>

      {/* ── LIVE STRIP (large only) ─── */}
      {!isMedium && mode === 'live' && sessionActive && (
        <div style={{
          padding: '8px 14px',
          background: theme.liveStripBg,
          borderBottom: '1px solid ' + theme.divider,
          display: 'flex', alignItems: 'center', gap: 10,
          flexShrink: 0,
        }}>
          <span style={{ position: 'relative', width: 8, height: 8 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: 999, background: theme.accent }} />
            <span style={{
              position: 'absolute', inset: -3, borderRadius: 999,
              background: theme.accent, opacity: 0.35,
              animation: 'sl-live-pulse 1.5s ease-out infinite',
            }} />
          </span>
          <span style={{ fontSize: 11.5, color: theme.ink2, fontWeight: 500 }}>screen check every 4s</span>
          <span style={{
            marginLeft: 'auto',
            fontFamily: 'Geist Mono, ui-monospace, monospace',
            fontSize: 10.5, color: theme.ink3,
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            3 steps done
          </span>
        </div>
      )}

      {/* ── BODY ─────────────────────────────────────── */}
      {isMedium ? (
        <div style={{
          flex: 1, padding: '10px 12px 4px',
          display: 'flex', flexDirection: 'column',
          minHeight: 0,
        }}>
          {latestAssistant ? (
            <div style={{
              fontSize: 13, lineHeight: 1.45,
              color: theme.ink,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}>
              {latestAssistant.content}
            </div>
          ) : (
            <div style={{
              fontSize: 12.5, color: theme.ink3, lineHeight: 1.45,
            }}>
              {sessionActive
                ? 'Watching — next instruction will appear here.'
                : 'Type a goal to start. Switch to Live to share your screen.'}
            </div>
          )}
        </div>
      ) : (
        <div ref={scrollRef} style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden',
          padding: '14px 14px 6px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }} className="sl-scroll">
          {messages.length === 0 ? (
            <EmptyState theme={theme} />
          ) : (
            messages.map((m, i) => <MessageRow key={i} m={m} theme={theme} />)
          )}
        </div>
      )}

      {/* ── INPUT ────────────────────────────────────── */}
      <div data-no-drag style={{
        padding: isMedium ? '6px 10px 10px' : '10px 12px 12px',
        borderTop: isMedium ? 'none' : '1px solid ' + theme.divider,
        background: isMedium ? 'transparent' : theme.headerBg,
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 8,
          background: theme.inputBg,
          border: '1px solid ' + theme.divider,
          borderRadius: 12,
          padding: '6px 6px 6px 12px',
        }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            rows={1}
            placeholder={sessionActive ? 'Ask a follow-up\u2026' : 'What do you want help with?'}
            style={{
              flex: 1,
              resize: 'none',
              border: 0, outline: 0, background: 'transparent',
              color: theme.ink,
              fontSize: 13,
              lineHeight: '20px',
              padding: '4px 0 2px',
              maxHeight: 84,
              fontFamily: 'inherit',
            }}
          />
          <button title="Voice input" style={inputIconBtn(theme)}>
            <MicGlyph c={theme.ink2} />
          </button>
          <button
            onClick={handleSend}
            disabled={!draft.trim()}
            title="Send"
            style={{
              width: 30, height: 30, borderRadius: 9,
              border: 0,
              background: draft.trim() ? theme.accent : theme.segTrack,
              color: draft.trim() ? theme.onAccent : theme.ink3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: draft.trim() ? 'pointer' : 'default',
              transition: 'background 160ms',
            }}
          >
            <ArrowUpGlyph c={draft.trim() ? theme.onAccent : theme.ink3} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes sl-live-pulse {
          0% { transform: scale(0.6); opacity: 0.5; }
          80% { transform: scale(2); opacity: 0; }
          100% { transform: scale(2); opacity: 0; }
        }
        @keyframes sl-window-bloom {
          0%, 100% { opacity: 0.75; transform: scale(0.98); }
          50%      { opacity: 1;    transform: scale(1.02); }
        }
        @keyframes sl-lava1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(40px, -20px) scale(1.15); }
          66%      { transform: translate(-20px, 30px) scale(0.9); }
        }
        @keyframes sl-lava2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(-30px, 50px) scale(1.2); }
        }
        .sl-scroll::-webkit-scrollbar { width: 6px; }
        .sl-scroll::-webkit-scrollbar-thumb { background: ${theme.divider}; border-radius: 3px; }
        .sl-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
    </div>
    </div>
  );
};

// ── Mode pills (compact form for medium header) ──────────────
const ModePills = ({ mode, setMode, theme }) => (
  <div style={{
    display: 'inline-flex',
    background: theme.segTrack,
    borderRadius: 7,
    padding: 2,
    height: 22,
  }}>
    <button onClick={() => setMode('text')} style={modePillBtn(mode === 'text', theme)} title="Text mode">
      <MsgGlyph c={mode === 'text' ? theme.ink : theme.ink2} />
    </button>
    <button onClick={() => setMode('live')} style={modePillBtn(mode === 'live', theme)} title="Live mode">
      <EyeGlyph c={mode === 'live' ? theme.accent : theme.ink2} />
    </button>
  </div>
);

const modePillBtn = (active, theme) => ({
  width: 26, height: 18,
  border: 0,
  background: active ? theme.segActive : 'transparent',
  borderRadius: 5,
  cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 160ms',
  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
});

// ── helpers ────────────────────────────────────────────────────

const segBtn = (active, theme) => ({
  flex: 1,
  position: 'relative',
  zIndex: 1,
  border: 0,
  background: 'transparent',
  color: active ? theme.ink : theme.ink2,
  fontWeight: active ? 600 : 500,
  fontSize: 12.5,
  fontFamily: 'inherit',
  letterSpacing: '-0.005em',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  cursor: 'pointer',
  transition: 'color 160ms',
});

const inputIconBtn = (theme) => ({
  width: 30, height: 30, borderRadius: 9,
  border: 0, background: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background 140ms',
});

const IconBtn = ({ theme, onClick, title, children }) => {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      data-no-drag
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 26, height: 26, borderRadius: 7,
        border: 0,
        background: hover ? theme.iconHover : 'transparent',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 140ms',
      }}
    >
      {children}
    </button>
  );
};

const EmptyState = ({ theme }) => (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '24px 12px', gap: 16 }}>
    {/* Mini orb */}
    <div style={{
      position: 'relative',
      width: 64, height: 64,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute', width: 64, height: 64, borderRadius: '50%',
        background: `radial-gradient(circle, ${theme.glowHalo} 0%, transparent 65%)`,
        filter: 'blur(10px)',
        animation: 'orb-halo 4.2s ease-in-out infinite',
      }} />
      <div style={{
        position: 'relative',
        width: 44, height: 44, borderRadius: '50%',
        background: `radial-gradient(circle at 35% 30%, ${theme.orbInner} 0%, ${theme.orbOuter} 75%)`,
        boxShadow: `0 0 16px 1px ${theme.glowRing}, inset 0 -6px 14px ${theme.glowOuter}, inset 0 2px 0 rgba(255,255,255,0.08)`,
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', width: 32, height: 32, borderRadius: '50%',
          left: '15%', top: '45%',
          background: `radial-gradient(circle, ${theme.glowLava1} 0%, ${theme.glowOuter} 50%, transparent 80%)`,
          filter: 'blur(5px)',
          animation: 'orb-blob1 5s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', width: 26, height: 26, borderRadius: '50%',
          right: '12%', top: '15%',
          background: `radial-gradient(circle, ${theme.glowLava2} 0%, ${theme.glowOuterSoft} 50%, transparent 80%)`,
          filter: 'blur(4px)',
          animation: 'orb-blob2 5s ease-in-out infinite',
        }} />
        <div style={{
          position: 'absolute', top: 4, left: 9,
          width: 12, height: 7, borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(255,255,255,0.45) 0%, transparent 70%)',
        }} />
      </div>
    </div>
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: theme.ink }}>
        What can I help with?
      </div>
      <div style={{ fontSize: 12.5, color: theme.ink2, lineHeight: 1.5, maxWidth: 260 }}>
        Type a goal, or switch to <b style={{ color: theme.ink }}>Live</b> and I'll watch your screen and walk you through it.
      </div>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 4 }}>
      {['Set up an S3 bucket', 'Partition my drive', 'Fix this error'].map(s => (
        <span key={s} style={{
          fontSize: 11.5,
          padding: '6px 10px',
          borderRadius: 999,
          background: theme.chipBg,
          color: theme.ink2,
          border: '1px solid ' + theme.divider,
          cursor: 'pointer',
        }}>{s}</span>
      ))}
    </div>
  </div>
);

const MessageRow = ({ m, theme }) => {
  if (m.type === 'step') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 4px 4px 6px',
        fontSize: 11.5, color: theme.ink3,
      }}>
        <span style={{
          width: 14, height: 14, borderRadius: 999,
          background: theme.okSoft, color: theme.ok,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="9" height="9" viewBox="0 0 9 9"><path d="M1 4.5l2 2 5-5" stroke={theme.ok} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span style={{ textDecoration: 'line-through', opacity: 0.85 }}>{m.content}</span>
      </div>
    );
  }
  const isUser = m.role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '82%',
        padding: '8px 12px',
        borderRadius: 14,
        borderBottomRightRadius: isUser ? 4 : 14,
        borderBottomLeftRadius: isUser ? 14 : 4,
        background: isUser ? theme.userBubble : theme.assistantBubble,
        color: isUser ? theme.userInk : theme.ink,
        fontSize: 13.5,
        lineHeight: 1.45,
        border: isUser ? 'none' : '1px solid ' + theme.divider,
      }}>
        {m.content}
      </div>
    </div>
  );
};

// ── glyphs ─────────────────────────────────────────────────────

const MinimizeGlyph = ({ c }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 9.5h7" stroke={c} strokeWidth="1.6" strokeLinecap="round" /></svg>
);
const ShrinkGlyph = ({ c }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M5 1v4H1M7 11V7h4" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);
const ExpandGlyph = ({ c }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M1 5V1h4M11 7v4H7" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);
const CogGlyph = ({ c }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <circle cx="7" cy="7" r="2" stroke={c} strokeWidth="1.4" />
    <path d="M7 1.5v1.6M7 10.9v1.6M12.5 7h-1.6M3.1 7H1.5M10.9 3.1l-1.1 1.1M4.2 9.8l-1.1 1.1M10.9 10.9l-1.1-1.1M4.2 4.2L3.1 3.1" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const SpeakerOnGlyph = ({ c }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 5v4h2l3 2.5v-9L4 5H2z" fill={c} fillOpacity="0.15" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M9.5 4.5c1 .8 1 4.2 0 5M11 3c1.6 1.4 1.6 6.6 0 8" stroke={c} strokeWidth="1.4" strokeLinecap="round" fill="none" />
  </svg>
);
const SpeakerOffGlyph = ({ c }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M2 5v4h2l3 2.5v-9L4 5H2z" fill="none" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M9 5l3.5 4M12.5 5L9 9" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const MsgGlyph = ({ c }) => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path d="M2 3.5h10v6H6.5L4 11.5v-2H2v-6z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
const EyeGlyph = ({ c }) => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path d="M1 7s2.4-4 6-4 6 4 6 4-2.4 4-6 4S1 7 1 7z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    <circle cx="7" cy="7" r="1.8" fill={c} />
  </svg>
);
const MicGlyph = ({ c }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="5" y="1.5" width="4" height="7" rx="2" stroke={c} strokeWidth="1.4" />
    <path d="M2.5 7c0 2.5 2 4.5 4.5 4.5S11.5 9.5 11.5 7M7 11.5v1.5" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const ArrowUpGlyph = ({ c }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M7 11V3M3.5 6.5L7 3l3.5 3.5" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

window.ChatWindow = ChatWindow;

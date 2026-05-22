// app.jsx — main app. Theme is now derived from Tweaks:
//   - color : terra | blue | green   (palette swap)
//   - glow  : subtle | medium | strong  (alpha + blur intensity)

const { useState, useEffect, useRef } = React;

// ─── Palettes ─────────────────────────────────────────────────
// Each palette defines the orb's lava color (accent), its deeper
// pull (accentDeep), the rgb triplet used in glow rgba(), and the
// dark "glass" colors used in the orb body & window radial.
const PALETTES = {
  terra: {
    accent: '#E89A5E', accentDeep: '#C2643B',
    glowRGB: '194,100,59',
    orbInner: '#2a1812', orbOuter: '#0a0604',
    windowTint: '#2a1c14',
  },
  blue: {
    accent: '#8FC4EC', accentDeep: '#5A93C7',
    glowRGB: '90,147,199',
    orbInner: '#0f1a26', orbOuter: '#04080f',
    windowTint: '#142233',
  },
  green: {
    accent: '#92D5B1', accentDeep: '#5BAE85',
    glowRGB: '91,174,133',
    orbInner: '#0f1f17', orbOuter: '#04090a',
    windowTint: '#142a20',
  },
};

const GLOWS = {
  subtle: { bloomA: 0.16, bloomSoftA: 0.05, haloA: 0.28, ringA: 0.45, ringWideA: 0.18, lavaA1: 0.55, lavaA2: 0.42, bgLavaA: 0.20 },
  medium: { bloomA: 0.32, bloomSoftA: 0.12, haloA: 0.42, ringA: 0.70, ringWideA: 0.35, lavaA1: 0.75, lavaA2: 0.55, bgLavaA: 0.35 },
  strong: { bloomA: 0.52, bloomSoftA: 0.24, haloA: 0.60, ringA: 0.90, ringWideA: 0.50, lavaA1: 0.95, lavaA2: 0.70, bgLavaA: 0.55 },
};

function rgba(rgb, a) { return `rgba(${rgb},${a})`; }

function makeTheme({ color, glow }) {
  const p = PALETTES[color] || PALETTES.blue;
  const g = GLOWS[glow] || GLOWS.subtle;
  return {
    // Surfaces
    bg: '#15110d',
    bgInner: '#1a1410',
    headerBg: '#1c1712',
    liveStripBg: rgba(p.glowRGB, 0.10),
    // Ink
    ink: '#F4E8DA',
    ink2: '#B8A89A',
    ink3: '#7A6E63',
    divider: 'rgba(244,232,218,0.08)',
    dividerStrong: 'rgba(244,232,218,0.14)',
    // Accents
    accent: p.accent,
    accentDeep: p.accentDeep,
    accentSoft: rgba(p.glowRGB, 0.18),
    onAccent: '#15110d',
    ok: '#5BD08B',
    okSoft: 'rgba(91,208,139,0.18)',
    // Controls
    iconHover: 'rgba(244,232,218,0.07)',
    segTrack: 'rgba(244,232,218,0.06)',
    segActive: 'rgba(244,232,218,0.14)',
    inputBg: 'rgba(244,232,218,0.04)',
    assistantBubble: 'rgba(244,232,218,0.05)',
    userBubble: `linear-gradient(180deg, ${p.accent} 0%, ${p.accentDeep} 100%)`,
    userInk: '#15110d',
    chipBg: 'rgba(244,232,218,0.04)',
    // Orb/window glass tokens
    orbInner: p.orbInner,
    orbOuter: p.orbOuter,
    windowTint: p.windowTint,
    glowRGB: p.glowRGB,
    // Glow intensities (alphas the orb & shell consume)
    glowOuter: rgba(p.glowRGB, g.bloomA),
    glowOuterSoft: rgba(p.glowRGB, g.bloomSoftA),
    glowHalo: rgba(p.glowRGB, g.haloA),
    glowRing: rgba(p.glowRGB, g.ringA),
    glowRingWide: rgba(p.glowRGB, g.ringWideA),
    glowLava1: rgba(p.glowRGB, g.lavaA1),
    glowLava2: rgba(p.glowRGB, g.lavaA2),
    glowBgLava: rgba(p.glowRGB, g.bgLavaA),
    // Back-compat
    bubbleSurface: 'transparent',
    bubbleInk: '#F4E8DA',
  };
}

const SAMPLE_MESSAGES = [
  { role: 'user', content: 'Help me set up an S3 bucket for backups.' },
  { type: 'step', content: 'Opened AWS console' },
  { type: 'step', content: 'Navigated to S3 service' },
  { role: 'assistant', content: 'Click the orange "Create bucket" button at the top right of the S3 page.' },
  { role: 'user', content: 'Done — which region?' },
  { role: 'assistant', content: 'I see us-east-1 selected. Keep that for now unless your team specified another. Type a unique bucket name next.' },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "color": "blue",
  "glow": "subtle"
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const theme = React.useMemo(() => makeTheme(t), [t.color, t.glow]);

  const [size, setSize] = useState('mini');
  const [lastOpen, setLastOpen] = useState('large');

  function go(next) {
    if (next !== 'mini') setLastOpen(next);
    setSize(next);
  }

  const [chatPos, setChatPos] = useState(() => {
    const w = window.innerWidth, h = window.innerHeight;
    return { x: Math.max(40, w - 420), y: 50 };
  });
  const [bubblePos, setBubblePos] = useState(() => ({
    x: window.innerWidth - 240,
    y: window.innerHeight - 260,
  }));

  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    captureInterval: 4,
    display: 'primary',
    voice: 'nova',
    alwaysOnTop: true,
    snap: true,
    dock: false,
  });

  const [mode, setMode] = useState('live');
  const [voiceOn, setVoiceOn] = useState(true);
  const [sessionActive, setSessionActive] = useState(true);
  const [messages, setMessages] = useState(SAMPLE_MESSAGES);
  const [notes, setNotes] = useState('');

  const steps = React.useMemo(
    () => messages.filter((m) => m.type === 'step'),
    [messages]
  );

  function patchSettings(p) { setSettings((s) => ({ ...s, ...p })); }

  function handleSend(text) {
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setTimeout(() => {
      setMessages((m) => [...m, { role: 'assistant', content: "Got it \u2014 I'll watch for that on the next check." }]);
    }, 600);
    if (!sessionActive) setSessionActive(true);
  }

  return (
    <>
      <Desktop />

      {size === 'mini' ? (
        <DPad
          pos={bubblePos}
          onDragEnd={setBubblePos}
          onOpenChat={() => go(lastOpen === 'mini' ? 'large' : lastOpen)}
          onShowSettings={() => { go(lastOpen === 'mini' ? 'large' : lastOpen); setShowSettings(true); }}
          onPickSize={(s) => go(s)}
          notes={notes}
          setNotes={setNotes}
          steps={steps}
          theme={theme}
          sessionActive={sessionActive}
        />
      ) : showSettings ? (
        <div style={{
          position: 'absolute', left: chatPos.x, top: chatPos.y,
          width: 380, height: 560,
          maxHeight: 'calc(100vh - 40px)',
        }}>
          <div style={{
            position: 'absolute',
            left: -70, right: -70, top: -30, bottom: -90,
            background: `radial-gradient(ellipse at 50% 75%, ${theme.glowOuter} 0%, ${theme.glowOuterSoft} 35%, transparent 70%)`,
            filter: 'blur(24px)',
            pointerEvents: 'none',
            animation: 'sl-window-bloom 5.5s ease-in-out infinite',
          }} />
          <div style={{
            position: 'relative',
            width: '100%', height: '100%',
            borderRadius: 18, overflow: 'hidden',
            background: `
              radial-gradient(ellipse at 30% 0%, ${theme.windowTint} 0%, transparent 55%),
              ${theme.bg}
            `,
            boxShadow: `
              0 0 0 1px rgba(244,232,218,0.06),
              0 0 40px 4px ${theme.glowOuterSoft},
              0 30px 80px rgba(0,0,0,0.55),
              inset 0 1px 0 rgba(255,255,255,0.06)
            `,
          }}>
            <SettingsSheet
              theme={theme}
              onClose={() => setShowSettings(false)}
              settings={settings}
              setSettings={patchSettings}
            />
          </div>
        </div>
      ) : (
        <ChatWindow
          pos={chatPos}
          onDragEnd={setChatPos}
          onClose={() => go('mini')}
          onOpenSettings={() => setShowSettings(true)}
          theme={theme}
          mode={mode} setMode={setMode}
          voiceOn={voiceOn} setVoiceOn={setVoiceOn}
          sessionActive={sessionActive}
          messages={messages}
          onSend={handleSend}
          size={size}
          onShrink={() => go('medium')}
          onExpand={() => go('large')}
        />
      )}

      <SizeJumper size={size} onSize={go} theme={theme} />

      <TweaksPanel>
        <TweakSection label="Glow color" />
        <TweakColor
          label="Accent"
          value={
            t.color === 'terra' ? '#E89A5E' :
            t.color === 'green' ? '#92D5B1' : '#8FC4EC'
          }
          options={['#8FC4EC', '#92D5B1', '#E89A5E']}
          onChange={(v) => {
            const next = v === '#92D5B1' ? 'green' : v === '#E89A5E' ? 'terra' : 'blue';
            setTweak('color', next);
          }}
        />
        <TweakSection label="Intensity" />
        <TweakRadio
          label="Glow"
          value={t.glow}
          options={['subtle', 'medium', 'strong']}
          onChange={(v) => setTweak('glow', v)}
        />
      </TweaksPanel>
    </>
  );
}

const SizeJumper = ({ size, onSize, theme }) => {
  const opts = [
    { id: 'mini',   label: 'Bubble', icon: <SJBubble /> },
    { id: 'medium', label: 'Peek',   icon: <SJMedium /> },
    { id: 'large',  label: 'Full',   icon: <SJLarge /> },
  ];
  return (
    <div style={{
      position: 'fixed',
      left: 20, bottom: 64,
      background: 'rgba(20,28,50,0.78)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRadius: 999,
      padding: 4,
      border: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      fontFamily: 'Geist, system-ui, sans-serif',
      zIndex: 1000,
    }}>
      <span style={{
        fontSize: 9.5, fontFamily: 'Geist Mono, ui-monospace, monospace',
        letterSpacing: '0.06em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.45)',
        padding: '0 10px 0 8px',
      }}>demo</span>
      {opts.map((o) => {
        const active = size === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onSize(o.id)}
            style={{
              border: 0,
              background: active ? 'rgba(255,255,255,0.16)' : 'transparent',
              color: active ? 'white' : 'rgba(255,255,255,0.6)',
              padding: '5px 11px',
              borderRadius: 999,
              fontSize: 11.5, fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              transition: 'background 160ms, color 160ms',
            }}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

const SJBubble = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3" /></svg>
);
const SJMedium = () => (
  <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><rect x="1" y="2" width="10" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.3" /></svg>
);
const SJLarge = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="1" width="9" height="9" rx="1.3" stroke="currentColor" strokeWidth="1.3" /></svg>
);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

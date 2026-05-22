// dpad.jsx — Unified D-pad chassis with a lava-core center.
// Two crossing dark-glass pills form one continuous body; the ball is gone —
// the cross's intersection IS the glow core. Each arm carries a semantic icon
// (Settings / Notes / Steps / Expand) and shows a label pill on hover.
// Click the core to open chat; drag the core to move the pad.

const SIZE   = 168;    // overall footprint
const ARM_W  = 54;     // pill thickness
const HALF   = SIZE / 2;
const HIT    = 40;     // icon hit-zone size at each tip

const DPad = ({
  pos, onDragEnd,
  onOpenChat,
  onShowSettings,
  onPickSize,
  notes, setNotes,
  steps,
  theme,
  sessionActive,
}) => {
  const [active, setActive]         = React.useState(null);
  const [hover, setHover]           = React.useState(null);
  const [centerHov, setCenterHov]   = React.useState(false);
  const [centerDown, setCenterDown] = React.useState(false);
  const dragRef = React.useRef({ dragging: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false });
  const rootRef = React.useRef(null);

  // Outside-click closes the flyout
  React.useEffect(() => {
    if (!active) return;
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setActive(null);
    }
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [active]);

  // Keyboard
  React.useEffect(() => {
    function onKey(e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      const dir = map[e.key];
      if (dir) { e.preventDefault(); handleDir(dir); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenChat(); }
      else if (e.key === 'Escape') setActive(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function handleDir(dir) {
    if (dir === 'up') { setActive(null); onShowSettings(); return; }
    setActive(a => a === dir ? null : dir);
  }

  // Center drag / tap
  function centerDownE(e) {
    setCenterDown(true);
    dragRef.current = { dragging: true, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function centerMoveE(e) {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) onDragEnd({ x: d.ox + dx, y: d.oy + dy });
  }
  function centerUpE(e) {
    const d = dragRef.current;
    setCenterDown(false);
    d.dragging = false;
    if (!d.moved) { setActive(null); onOpenChat(); }
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const ARMS = [
    { dir: 'up',    label: 'Settings', Icon: GearIcon },
    { dir: 'right', label: 'Expand',   Icon: ExpandIcon },
    { dir: 'down',  label: 'Notes',    Icon: NotesIcon },
    { dir: 'left',  label: 'Steps',    Icon: StepsIcon },
  ];

  const someFlyoutOpen = active != null;

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute',
        left: pos.x - SIZE / 2,
        top:  pos.y - SIZE / 2,
        width: SIZE, height: SIZE,
      }}
    >
      {/* Ambient ground bloom */}
      <div style={{
        position: 'absolute',
        inset: -34,
        background: `radial-gradient(ellipse at 50% 55%, ${theme.glowOuter} 0%, ${theme.glowOuterSoft} 45%, transparent 75%)`,
        filter: 'blur(22px)',
        pointerEvents: 'none',
        animation: 'dpad-bloom 5.5s ease-in-out infinite',
      }} />

      {/* CHASSIS — two crossing dark-glass pills, forming one continuous body */}
      <Chassis theme={theme} active={active} hover={hover} centerHov={centerHov} centerDown={centerDown} />

      {/* CENTER hit zone (transparent — over the visual core) */}
      <div
        onPointerDown={centerDownE}
        onPointerMove={centerMoveE}
        onPointerUp={centerUpE}
        onMouseEnter={() => setCenterHov(true)}
        onMouseLeave={() => setCenterHov(false)}
        title="Open SightLine (drag to move)"
        style={{
          position: 'absolute',
          left: HALF - 26, top: HALF - 26,
          width: 52, height: 52,
          borderRadius: '50%',
          cursor: centerDown ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
          zIndex: 4,
        }}
      />

      {/* 4 ARM ICONS */}
      {ARMS.map(arm => (
        <ArmZone
          key={arm.dir}
          dir={arm.dir}
          label={arm.label}
          Icon={arm.Icon}
          theme={theme}
          active={active === arm.dir}
          hover={hover === arm.dir}
          showLabel={hover === arm.dir && !someFlyoutOpen}
          onEnter={() => setHover(arm.dir)}
          onLeave={() => setHover(null)}
          onTap={() => handleDir(arm.dir)}
        />
      ))}

      {/* Status dot */}
      {sessionActive && (
        <span style={{
          position: 'absolute',
          right: HALF - ARM_W/2 - 12, top: HALF - ARM_W/2 - 12,
          width: 9, height: 9, borderRadius: 999,
          background: theme.ok,
          boxShadow: `0 0 0 2px ${theme.orbOuter}, 0 0 8px ${theme.ok}`,
          pointerEvents: 'none',
          zIndex: 5,
        }} />
      )}

      {/* FLYOUTS */}
      {active === 'down' && (
        <Flyout dir="down" theme={theme} title="Quick note" onClose={() => setActive(null)}>
          <NotesPanel notes={notes} setNotes={setNotes} theme={theme} />
        </Flyout>
      )}
      {active === 'left' && (
        <Flyout dir="left" theme={theme} title="Steps" onClose={() => setActive(null)} count={steps.length}>
          <StepsPanel steps={steps} theme={theme} />
        </Flyout>
      )}
      {active === 'right' && (
        <Flyout dir="right" theme={theme} title="Open as" onClose={() => setActive(null)}>
          <ExpandPanel theme={theme} onPick={(s) => { setActive(null); onPickSize(s); }} />
        </Flyout>
      )}

      <style>{`
        @keyframes dpad-bloom {
          0%, 100% { opacity: 0.7; transform: scale(0.98); }
          50%      { opacity: 1;   transform: scale(1.04); }
        }
        @keyframes dpad-core-pulse {
          0%, 100% { opacity: 0.85; transform: translate(-50%, -50%) scale(1); }
          50%      { opacity: 1;    transform: translate(-50%, -50%) scale(1.08); }
        }
        @keyframes dpad-blob1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(6px, -8px) scale(1.15); }
          66%      { transform: translate(-5px, 5px) scale(0.9); }
        }
        @keyframes dpad-blob2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(-9px, 10px) scale(1.2); }
        }
        @keyframes dpad-label-in {
          from { opacity: 0; transform: translate(var(--lx,0), var(--ly,0)) scale(0.92); }
          to   { opacity: 1; transform: translate(0, 0) scale(1); }
        }
        @keyframes dpad-flyout-up   { from { opacity: 0; transform: translateY(8px)  scale(0.96); } to { opacity: 1; transform: none; } }
        @keyframes dpad-flyout-down { from { opacity: 0; transform: translateY(-8px) scale(0.96); } to { opacity: 1; transform: none; } }
        @keyframes dpad-flyout-left { from { opacity: 0; transform: translateX(8px)  scale(0.96); } to { opacity: 1; transform: none; } }
        @keyframes dpad-flyout-right{ from { opacity: 0; transform: translateX(-8px) scale(0.96); } to { opacity: 1; transform: none; } }
        @keyframes dpad-pulse-ring {
          0%   { transform: translate(-50%, -50%) scale(0.8); opacity: 0.55; }
          100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
};

// ── chassis ───────────────────────────────────────────────────
const Chassis = ({ theme, active, hover, centerHov, centerDown }) => {
  const pillBg = `radial-gradient(ellipse at 50% 0%, ${theme.orbInner} 0%, ${theme.orbOuter} 80%)`;
  const pillShadow = `
    inset 0 1px 0 rgba(255,255,255,0.07),
    inset 0 -2px 8px rgba(0,0,0,0.55),
    0 0 0 1px rgba(244,232,218,0.06),
    0 10px 26px rgba(0,0,0,0.45)
  `;

  // arm-highlight overlays (one per arm) — slight inner-glow tint on hover/active
  function armGlow(dir) {
    const isActive = active === dir;
    const isHover  = hover === dir && !isActive;
    if (!isActive && !isHover) return null;

    const intensity = isActive ? 1 : 0.45;
    const armStyle = {
      position: 'absolute',
      borderRadius: 999,
      background: isActive
        ? `radial-gradient(circle, ${theme.accent}55 0%, transparent 70%)`
        : `radial-gradient(circle, ${theme.glowRing} 0%, transparent 70%)`,
      mixBlendMode: 'screen',
      opacity: intensity,
      pointerEvents: 'none',
      transition: 'opacity 220ms',
      filter: 'blur(2px)',
    };
    if (dir === 'up')    return <div style={{ ...armStyle, left: HALF - ARM_W/2, top: 0,           width: ARM_W, height: HALF - 4 }} />;
    if (dir === 'down')  return <div style={{ ...armStyle, left: HALF - ARM_W/2, top: HALF + 4,    width: ARM_W, height: HALF - 4 }} />;
    if (dir === 'left')  return <div style={{ ...armStyle, top: HALF - ARM_W/2, left: 0,           width: HALF - 4, height: ARM_W }} />;
    if (dir === 'right') return <div style={{ ...armStyle, top: HALF - ARM_W/2, left: HALF + 4,    width: HALF - 4, height: ARM_W }} />;
    return null;
  }

  // press-ring on the core when activated (Enter / center down)
  const pulse = centerDown;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Horizontal pill */}
      <div style={{
        position: 'absolute',
        left: 0, right: 0, top: HALF - ARM_W/2, height: ARM_W,
        borderRadius: ARM_W/2,
        background: pillBg,
        boxShadow: pillShadow,
      }} />
      {/* Vertical pill */}
      <div style={{
        position: 'absolute',
        top: 0, bottom: 0, left: HALF - ARM_W/2, width: ARM_W,
        borderRadius: ARM_W/2,
        background: pillBg,
        boxShadow: pillShadow,
      }} />

      {/* Subtle specular highlight along the top of each pill */}
      <div style={{
        position: 'absolute',
        top: HALF - ARM_W/2 + 1, left: 14, right: 14, height: 1,
        background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.14), transparent)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        left: HALF - ARM_W/2 + 1, top: 14, bottom: 14, width: 1,
        background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.10), transparent)',
        pointerEvents: 'none',
      }} />

      {/* Per-arm highlight */}
      {armGlow('up')}
      {armGlow('down')}
      {armGlow('left')}
      {armGlow('right')}

      {/* CENTER LAVA CORE — light bleeds out of a vent at the cross intersection */}
      {/* Outer breathing halo */}
      <div style={{
        position: 'absolute',
        left: HALF, top: HALF,
        width: 96, height: 96,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${theme.accent}66 0%, ${theme.accentDeep}33 35%, transparent 75%)`,
        filter: 'blur(12px)',
        animation: 'dpad-core-pulse 4.2s ease-in-out infinite',
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)',
      }} />

      {/* Vent — looking down into a furnace: hot at the bottom, darker rim */}
      <div style={{
        position: 'absolute',
        left: HALF - 24, top: HALF - 24,
        width: 48, height: 48,
        borderRadius: '50%',
        overflow: 'hidden',
        background: `radial-gradient(circle at 50% 70%, ${theme.accent}dd 0%, ${theme.accentDeep}88 22%, ${theme.orbInner} 55%, ${theme.orbOuter} 88%)`,
        boxShadow: `
          inset 0 0 0 1px rgba(0,0,0,0.65),
          inset 0 -4px 10px rgba(0,0,0,0.55),
          inset 0 2px 4px rgba(255,255,255,0.06),
          0 0 0 1px ${theme.accent}33,
          0 0 16px 1px ${theme.accent}66,
          0 0 40px 8px ${theme.accentDeep}33
        `,
        transform: `scale(${centerDown ? 0.95 : centerHov ? 1.06 : 1})`,
        transition: 'transform 220ms cubic-bezier(0.3,0,0.2,1)',
      }}>
        {/* lava blob 1 — uses accent directly so the core always reads luminous */}
        <div style={{
          position: 'absolute', width: 36, height: 36, borderRadius: '50%',
          left: '12%', top: '42%',
          background: `radial-gradient(circle, ${theme.accent}ee 0%, ${theme.accentDeep}77 45%, transparent 80%)`,
          filter: 'blur(5px)',
          animation: 'dpad-blob1 5s ease-in-out infinite',
        }} />
        {/* lava blob 2 */}
        <div style={{
          position: 'absolute', width: 28, height: 28, borderRadius: '50%',
          right: '10%', top: '12%',
          background: `radial-gradient(circle, ${theme.accent}cc 0%, ${theme.accentDeep}55 50%, transparent 80%)`,
          filter: 'blur(4px)',
          animation: 'dpad-blob2 5s ease-in-out infinite',
        }} />
        {/* specular highlight */}
        <div style={{
          position: 'absolute', top: 5, left: 11,
          width: 14, height: 7, borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(255,255,255,0.55) 0%, transparent 70%)',
        }} />
      </div>

      {/* Press pulse ring */}
      {pulse && (
        <div style={{
          position: 'absolute',
          left: HALF, top: HALF,
          width: 48, height: 48,
          borderRadius: '50%',
          border: `2px solid ${theme.accent}`,
          opacity: 0.5,
          animation: 'dpad-pulse-ring 600ms ease-out',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  );
};

// ── arm zone (icon + hover label) ─────────────────────────────
const ArmZone = ({ dir, label, Icon, theme, active, hover, showLabel, onEnter, onLeave, onTap }) => {
  // Position the hit zone at the tip of each arm
  const margin = 8;
  let pos = {};
  if (dir === 'up')    pos = { left: HALF - HIT/2, top: margin };
  if (dir === 'down')  pos = { left: HALF - HIT/2, top: SIZE - HIT - margin };
  if (dir === 'left')  pos = { left: margin, top: HALF - HIT/2 };
  if (dir === 'right') pos = { left: SIZE - HIT - margin, top: HALF - HIT/2 };

  const inkC = active ? '#fff' : hover ? theme.ink : theme.ink2;

  return (
    <>
      <button
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={onTap}
        title={label}
        style={{
          position: 'absolute',
          ...pos,
          width: HIT, height: HIT,
          border: 0, background: 'transparent',
          cursor: 'pointer',
          borderRadius: '50%',
          display: 'grid', placeItems: 'center',
          zIndex: 3,
          transition: 'transform 140ms',
          transform: active ? 'scale(0.92)' : 'scale(1)',
        }}
      >
        {/* icon halo on hover/active */}
        {(hover || active) && (
          <span style={{
            position: 'absolute', inset: 4,
            borderRadius: '50%',
            background: active
              ? `radial-gradient(circle, ${theme.accent}66 0%, transparent 70%)`
              : `radial-gradient(circle, ${theme.glowRing} 0%, transparent 70%)`,
            filter: 'blur(3px)',
            pointerEvents: 'none',
          }} />
        )}
        <Icon c={inkC} />
      </button>

      {/* Hover label pill */}
      {showLabel && <ArmLabel dir={dir} label={label} theme={theme} />}
    </>
  );
};

const ArmLabel = ({ dir, label, theme }) => {
  let pos = {}, lx = 0, ly = 0;
  if (dir === 'up')    { pos = { left: '50%', bottom: SIZE + 6, transform: 'translateX(-50%)' }; ly = 6; }
  if (dir === 'down')  { pos = { left: '50%', top: SIZE + 6,    transform: 'translateX(-50%)' }; ly = -6; }
  if (dir === 'left')  { pos = { right: SIZE + 6, top: '50%',   transform: 'translateY(-50%)' }; lx = 6; }
  if (dir === 'right') { pos = { left: SIZE + 6,  top: '50%',   transform: 'translateY(-50%)' }; lx = -6; }

  return (
    <div style={{
      position: 'absolute',
      ...pos,
      padding: '4px 10px',
      borderRadius: 999,
      background: 'rgba(20,16,12,0.92)',
      color: theme.ink,
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
      border: '1px solid ' + theme.divider,
      boxShadow: `0 6px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(244,232,218,0.04)`,
      fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
      pointerEvents: 'none',
      zIndex: 6,
      ['--lx']: `${lx}px`, ['--ly']: `${ly}px`,
      animation: 'dpad-label-in 180ms cubic-bezier(0.2,0,0.1,1) both',
    }}>{label}</div>
  );
};

// ── icons ─────────────────────────────────────────────────────
const GearIcon = ({ c }) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
    <circle cx="9" cy="9" r="2.6" stroke={c} strokeWidth="1.4" />
    <path d="M9 1.6v2M9 14.4v2M16.4 9h-2M3.6 9h-2M14.2 3.8l-1.4 1.4M5.2 12.8l-1.4 1.4M14.2 14.2l-1.4-1.4M5.2 5.2L3.8 3.8" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const NotesIcon = ({ c }) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
    <path d="M4 2.5h7l3 3v10H4z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M11 2.5v3h3" stroke={c} strokeWidth="1.4" strokeLinejoin="round" fill="none" />
    <path d="M6.5 9h5M6.5 11.5h5M6.5 14h3" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const StepsIcon = ({ c }) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
    <path d="M2 4.2l1.6 1.6 3-3" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <path d="M2 9l1.6 1.6 3-3" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <circle cx="3.6" cy="14.4" r="1.1" fill={c} />
    <path d="M9 4h7M9 9h7M9 14h5" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const ExpandIcon = ({ c }) => (
  <svg width="17" height="17" viewBox="0 0 18 18" fill="none">
    <path d="M2 6V2.5h3.5M16 6V2.5h-3.5M2 12v3.5h3.5M16 12v3.5h-3.5" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

// ── flyout shell ──────────────────────────────────────────────
const Flyout = ({ dir, title, onClose, children, theme, count }) => {
  const GAP = 14;
  const W = dir === 'left' || dir === 'right' ? 240 : 260;
  const H = dir === 'left' || dir === 'right' ? 220 : 180;

  let baseStyle = { width: W, height: H };
  if (dir === 'down')  baseStyle = { ...baseStyle, left: SIZE/2 - W/2, top: SIZE + GAP };
  if (dir === 'left')  baseStyle = { ...baseStyle, right: SIZE + GAP, top: SIZE/2 - H/2 };
  if (dir === 'right') baseStyle = { ...baseStyle, left: SIZE + GAP, top: SIZE/2 - H/2 };
  if (dir === 'up')    baseStyle = { ...baseStyle, left: SIZE/2 - W/2, bottom: SIZE + GAP };

  // Keep inside viewport
  const wrapRef = React.useRef(null);
  const [shift, setShift] = React.useState({ x: 0, y: 0 });
  React.useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const pad = 12;
    let dx = 0, dy = 0;
    if (r.left < pad)                          dx = pad - r.left;
    if (r.right > window.innerWidth - pad)     dx = window.innerWidth - pad - r.right;
    if (r.top < pad)                           dy = pad - r.top;
    if (r.bottom > window.innerHeight - pad)   dy = window.innerHeight - pad - r.bottom;
    setShift({ x: dx, y: dy });
  }, [dir]);

  const notchOffset = (dir === 'down' || dir === 'up')
    ? Math.max(-W/2 + 16, Math.min(W/2 - 16, -shift.x))
    : Math.max(-H/2 + 16, Math.min(H/2 - 16, -shift.y));

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'absolute',
        ...baseStyle,
        marginLeft: shift.x,
        marginTop:  shift.y,
        animation: `dpad-flyout-${dir} 220ms cubic-bezier(0.2,0,0.1,1)`,
        transformOrigin:
          dir === 'down'  ? '50% 0%'   :
          dir === 'up'    ? '50% 100%' :
          dir === 'left'  ? '100% 50%' :
                            '0% 50%',
        zIndex: 10,
      }}
    >
      <div style={{
        position: 'absolute', inset: -16,
        background: `radial-gradient(ellipse at 50% 50%, ${theme.glowOuterSoft} 0%, transparent 70%)`,
        filter: 'blur(18px)',
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative',
        width: '100%', height: '100%',
        borderRadius: 14, overflow: 'hidden',
        background: `
          radial-gradient(ellipse at 30% 0%, ${theme.windowTint} 0%, transparent 55%),
          ${theme.bg}
        `,
        color: theme.ink,
        boxShadow: `
          0 0 0 1px rgba(244,232,218,0.06),
          0 18px 40px rgba(0,0,0,0.55),
          inset 0 1px 0 rgba(255,255,255,0.05)
        `,
        display: 'flex', flexDirection: 'column',
        fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
      }}>
        <div style={{
          padding: '9px 10px 8px 12px',
          display: 'flex', alignItems: 'center', gap: 8,
          borderBottom: '1px solid ' + theme.divider,
          background: theme.headerBg,
        }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '-0.005em' }}>{title}</span>
          {count != null && (
            <span style={{
              fontFamily: 'Geist Mono, ui-monospace, monospace',
              fontSize: 10, color: theme.ink3,
              padding: '1px 6px', borderRadius: 999,
              background: theme.chipBg,
              border: '1px solid ' + theme.divider,
            }}>{count}</span>
          )}
          <button onClick={onClose} title="Close" style={{
            marginLeft: 'auto',
            width: 22, height: 22, borderRadius: 6,
            border: 0, background: 'transparent', cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2l6 6M8 2l-6 6" stroke={theme.ink2} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>

      <Notch dir={dir} theme={theme} offset={notchOffset} />
    </div>
  );
};

const Notch = ({ dir, theme, offset = 0 }) => {
  const s = { position: 'absolute', width: 10, height: 10,
              background: theme.bg,
              border: '1px solid rgba(244,232,218,0.06)',
              borderLeft: 0, borderTop: 0,
              transform: 'rotate(45deg)' };
  if (dir === 'down')  return <div style={{ ...s, top: -5, left: `calc(50% + ${offset}px)`, marginLeft: -5, transform: 'rotate(225deg)' }} />;
  if (dir === 'up')    return <div style={{ ...s, bottom: -5, left: `calc(50% + ${offset}px)`, marginLeft: -5 }} />;
  if (dir === 'left')  return <div style={{ ...s, right: -5, top: `calc(50% + ${offset}px)`,  marginTop: -5, transform: 'rotate(-45deg)' }} />;
  if (dir === 'right') return <div style={{ ...s, left: -5, top: `calc(50% + ${offset}px)`,   marginTop: -5, transform: 'rotate(135deg)' }} />;
  return null;
};

// ── notes panel (DOWN) ────────────────────────────────────────
const NotesPanel = ({ notes, setNotes, theme }) => {
  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Jot something — saved to this session."
        style={{
          flex: 1,
          resize: 'none',
          border: '1px solid ' + theme.divider,
          background: theme.inputBg,
          borderRadius: 9,
          padding: '8px 10px',
          color: theme.ink,
          fontSize: 12.5,
          lineHeight: 1.45,
          outline: 0,
          fontFamily: 'inherit',
          minHeight: 0,
        }}
      />
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: 'Geist Mono, ui-monospace, monospace',
        fontSize: 10, color: theme.ink3,
        letterSpacing: '0.04em',
      }}>
        <span>{notes.length} chars</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: 999, background: theme.ok, boxShadow: '0 0 6px ' + theme.ok }} />
          autosaved
        </span>
      </div>
    </div>
  );
};

// ── steps panel (LEFT) ────────────────────────────────────────
const StepsPanel = ({ steps, theme }) => {
  if (!steps.length) {
    return (
      <div style={{
        flex: 1, display: 'grid', placeItems: 'center',
        padding: 14, textAlign: 'center',
        color: theme.ink3, fontSize: 12, lineHeight: 1.5,
      }}>
        No steps yet — they'll show up here as SightLine completes them.
      </div>
    );
  }
  return (
    <div className="sl-scroll" style={{
      flex: 1, overflowY: 'auto',
      padding: '8px 10px 10px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            padding: '4px 4px 4px 2px',
            fontSize: 12, color: last ? theme.ink : theme.ink2,
          }}>
            <span style={{
              width: 14, height: 14, borderRadius: 999,
              background: last ? theme.accentSoft : theme.okSoft,
              display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1,
            }}>
              {last
                ? <span style={{ width: 6, height: 6, borderRadius: 999, background: theme.accent,
                                 boxShadow: '0 0 6px ' + theme.accent,
                                 animation: 'sl-live-pulse 1.5s ease-out infinite' }} />
                : <svg width="9" height="9" viewBox="0 0 9 9"><path d="M1 4.5l2 2 5-5" stroke={theme.ok} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              }
            </span>
            <span style={{
              lineHeight: 1.35,
              textDecoration: last ? 'none' : 'line-through',
              opacity: last ? 1 : 0.85,
            }}>{s.content}</span>
          </div>
        );
      })}
      <style>{`@keyframes sl-live-pulse { 0% { transform: scale(0.6); opacity: 0.5; } 80% { transform: scale(2); opacity: 0; } 100% { transform: scale(2); opacity: 0; } }`}</style>
    </div>
  );
};

// ── expand panel (RIGHT) ──────────────────────────────────────
const ExpandPanel = ({ theme, onPick }) => {
  const opts = [
    { id: 'medium', label: 'Peek',  hint: 'latest reply only', icon: 'medium' },
    { id: 'large',  label: 'Full',  hint: 'full conversation', icon: 'large'  },
  ];
  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      {opts.map(o => (
        <button
          key={o.id}
          onClick={() => onPick(o.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            border: '1px solid ' + theme.divider,
            background: theme.chipBg,
            color: theme.ink,
            borderRadius: 9,
            padding: '9px 10px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
            transition: 'background 140ms, border-color 140ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = theme.iconHover; e.currentTarget.style.borderColor = theme.dividerStrong; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = theme.chipBg;    e.currentTarget.style.borderColor = theme.divider; }}
        >
          <span style={{
            width: 28, height: 22, borderRadius: 5,
            border: '1px solid ' + theme.dividerStrong,
            display: 'grid', placeItems: 'center',
            background: 'rgba(244,232,218,0.04)',
            flexShrink: 0,
          }}>
            {o.icon === 'medium'
              ? <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><rect x="1" y="2" width="12" height="6" rx="1.5" stroke={theme.ink2} strokeWidth="1.2" /></svg>
              : <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="11" height="11" rx="1.5" stroke={theme.ink2} strokeWidth="1.2" /></svg>
            }
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.005em' }}>{o.label}</span>
            <span style={{ fontSize: 10.5, color: theme.ink3, fontFamily: 'Geist Mono, ui-monospace, monospace', letterSpacing: '0.02em' }}>{o.hint}</span>
          </span>
          <span style={{ marginLeft: 'auto', color: theme.ink3 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3 1l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </button>
      ))}
    </div>
  );
};

window.DPad = DPad;

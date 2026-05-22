// settings-sheet.jsx — overlay sheet inside the chat window for deeper settings.
// API key fields are intentionally removed. Voice toggle lives in the header,
// so this sheet only houses: capture interval, display, voice picker,
// overlay opacity (kept for backward compat), and read-aloud preview.

const SettingsSheet = ({ theme, onClose, settings, setSettings }) => {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: theme.bg,
      display: 'flex', flexDirection: 'column',
      animation: 'sl-sheet-in 220ms cubic-bezier(0.2,0,0.1,1)',
    }}>
      {/* sheet header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid ' + theme.divider,
        display: 'flex', alignItems: 'center', gap: 10,
        background: theme.headerBg,
      }}>
        <button onClick={onClose} style={{
          width: 28, height: 28, borderRadius: 8,
          border: 0, background: 'transparent', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} title="Back">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2L4 7l5 5" stroke={theme.ink2} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em' }}>Settings</span>
        <button onClick={onClose} style={{
          marginLeft: 'auto',
          width: 28, height: 28, borderRadius: 8,
          border: 0, background: 'transparent', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} title="Close">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke={theme.ink2} strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>

      {/* body */}
      <div className="sl-scroll" style={{
        flex: 1, overflowY: 'auto',
        padding: '16px 14px 18px',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <SettingsGroup theme={theme} label="Capture">
          <SettingRow theme={theme} label="Check frequency" hint={`every ${settings.captureInterval}s`}>
            <input
              type="range"
              min={2} max={30} step={1}
              value={settings.captureInterval}
              onChange={(e) => setSettings({ captureInterval: Number(e.target.value) })}
              style={rangeStyle(theme, (settings.captureInterval - 2) / 28)}
            />
            <div style={tickRow(theme)}>
              <span>2s</span><span>10s</span><span>20s</span><span>30s</span>
            </div>
          </SettingRow>

          <SettingRow theme={theme} label="Display">
            <select
              value={settings.display}
              onChange={(e) => setSettings({ display: e.target.value })}
              style={selectStyle(theme)}
            >
              <option value="primary">Primary display</option>
              <option value="secondary">External — Dell U2723QE</option>
            </select>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup theme={theme} label="Voice">
          <SettingRow theme={theme} label="Voice character">
            <select
              value={settings.voice}
              onChange={(e) => setSettings({ voice: e.target.value })}
              style={selectStyle(theme)}
            >
              <option value="nova">Nova — warm, friendly</option>
              <option value="shimmer">Shimmer — bright, upbeat</option>
              <option value="sage">Sage — calm, thoughtful</option>
              <option value="onyx">Onyx — deeper, steady</option>
              <option value="alloy">Alloy — neutral, clear</option>
            </select>
          </SettingRow>
          <button style={{
            alignSelf: 'flex-start',
            padding: '7px 12px',
            borderRadius: 9,
            background: theme.chipBg,
            border: '1px solid ' + theme.divider,
            color: theme.ink, fontSize: 12, fontWeight: 500,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'inherit',
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 1l6 4-6 4z" fill={theme.ink} /></svg>
            Preview voice
          </button>
        </SettingsGroup>

        <SettingsGroup theme={theme} label="Window">
          <ToggleRow theme={theme} label="Always on top"
            checked={settings.alwaysOnTop}
            onChange={(v) => setSettings({ alwaysOnTop: v })} />
          <ToggleRow theme={theme} label="Snap to edges"
            checked={settings.snap}
            onChange={(v) => setSettings({ snap: v })} />
          <ToggleRow theme={theme} label="Show in dock"
            checked={settings.dock}
            onChange={(v) => setSettings({ dock: v })} />
        </SettingsGroup>

        <SettingsGroup theme={theme} label="Privacy">
          <div style={{
            padding: 10,
            background: theme.chipBg,
            border: '1px solid ' + theme.divider,
            borderRadius: 10,
            fontSize: 11.5, lineHeight: 1.5, color: theme.ink2,
          }}>
            Screenshots stay in memory only — never written to disk. API credentials are stored in your system keychain.
          </div>
          <button style={{
            alignSelf: 'flex-start',
            padding: '7px 12px',
            borderRadius: 9,
            background: 'transparent',
            border: '1px solid ' + theme.divider,
            color: theme.ink2, fontSize: 12, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Clear session history
          </button>
        </SettingsGroup>

        <div style={{
          marginTop: 4,
          fontSize: 10.5,
          fontFamily: 'Geist Mono, ui-monospace, monospace',
          color: theme.ink3,
          letterSpacing: '0.04em', textTransform: 'uppercase',
          textAlign: 'center',
        }}>
          SightLine · v1.4.0
        </div>
      </div>

      <style>{`
        @keyframes sl-sheet-in {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
};

const SettingsGroup = ({ theme, label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{
      fontSize: 10.5,
      fontFamily: 'Geist Mono, ui-monospace, monospace',
      color: theme.ink3,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      fontWeight: 500,
    }}>{label}</div>
    {children}
  </div>
);

const SettingRow = ({ theme, label, hint, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 12.5, color: theme.ink, fontWeight: 500 }}>{label}</span>
      {hint && <span style={{ fontSize: 11, color: theme.ink3, fontFamily: 'Geist Mono, ui-monospace, monospace' }}>{hint}</span>}
    </div>
    {children}
  </div>
);

const ToggleRow = ({ theme, label, checked, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <span style={{ fontSize: 12.5, color: theme.ink, fontWeight: 500 }}>{label}</span>
    <button
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 34, height: 20, borderRadius: 999,
        background: checked ? theme.accent : theme.segTrack,
        border: 0, cursor: 'pointer',
        transition: 'background 180ms',
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute',
        top: 2, left: checked ? 16 : 2,
        width: 16, height: 16, borderRadius: 999,
        background: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        transition: 'left 180ms cubic-bezier(0.3,0,0.2,1)',
      }} />
    </button>
  </div>
);

const selectStyle = (theme) => ({
  width: '100%',
  padding: '8px 10px',
  background: theme.chipBg,
  color: theme.ink,
  border: '1px solid ' + theme.divider,
  borderRadius: 10,
  fontSize: 12.5,
  fontFamily: 'inherit',
  outline: 'none',
  cursor: 'pointer',
  appearance: 'none',
  WebkitAppearance: 'none',
  backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M1 1l4 4 4-4' stroke='${encodeURIComponent(theme.ink2)}' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>")`.replace('%23','#'),
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  paddingRight: 28,
});

const rangeStyle = (theme, frac) => ({
  width: '100%',
  appearance: 'none',
  height: 6,
  borderRadius: 999,
  background: `linear-gradient(to right, ${theme.accent} 0%, ${theme.accent} ${frac*100}%, ${theme.segTrack} ${frac*100}%, ${theme.segTrack} 100%)`,
  outline: 'none',
  cursor: 'pointer',
});

const tickRow = (theme) => ({
  display: 'flex', justifyContent: 'space-between',
  fontFamily: 'Geist Mono, ui-monospace, monospace',
  fontSize: 10, color: theme.ink3, marginTop: 2,
});

// Add range thumb styles globally once
if (!document.getElementById('sl-range-thumb')) {
  const s = document.createElement('style');
  s.id = 'sl-range-thumb';
  s.textContent = `
    input[type=range]::-webkit-slider-thumb {
      appearance: none; width: 16px; height: 16px; border-radius: 999px;
      background: white; border: 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.05);
      cursor: pointer;
    }
    input[type=range]::-moz-range-thumb {
      width: 16px; height: 16px; border-radius: 999px;
      background: white; border: 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.25);
      cursor: pointer;
    }
  `;
  document.head.appendChild(s);
}

window.SettingsSheet = SettingsSheet;

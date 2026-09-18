export function Icon({ name, size = 22 }: { name: 'arrows' | 'upload' | 'devices' | 'file' | 'lock' | 'info' | 'close'; size?: number }) {
  const paths = {
    arrows: <><path d="M3 6h17l-4-4M21 18H4l4 4"/><path d="m20 6-4 4M4 18l4-4"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
    devices: <><rect x="2" y="3" width="22" height="16" rx=".6"/><path d="M.7 20h24.6l-1.5 2H2.2z"/><rect x="29" y="7" width="6" height="15" rx=".7"/><path d="M31 7.8h2"/></>,
    file: <><path d="M5 2h9l5 5v15H5zM14 2v6h5"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
  };
  return <svg width={size} height={size} viewBox={name === 'devices' ? '0 0 36 24' : '0 0 24 24'} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

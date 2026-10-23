import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export function Dialog({ title, onClose, children, className = '' }) {
 const ref = useRef(null);
 useEffect(() => {
  const previous = document.activeElement;
  const dialog = ref.current;
  dialog.showModal();
  return () => { dialog.close(); previous?.focus(); };
 }, []);
 return <dialog ref={ref} className={`dialog ${className}`} aria-labelledby="dialog-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="dialog-inner"><header><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></header>{children}</div></dialog>;
}

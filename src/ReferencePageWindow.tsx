import { useEffect, useState } from 'react';
import { initialReferencePageFromUrl, listenReferencePage } from './notesbus';

// The popped-out viewer for the original scanned page a Structure diagram
// was transcribed from. The transcribed outline in the pane is the primary
// representation; this is the "show me the actual page" affordance beside it.
//
// The PDF is rendered by the webview's own viewer via an <iframe>, which
// brings scrolling, zoom and page navigation for free — the whole scanned
// chapter is there, not just the cropped diagram. `#page=` opens it at the
// page the diagram came from.
//
// Seeded from its own URL, then kept current over the refpage:show event so
// a second "View original page" swaps the document in this window instead of
// opening another one.
export default function ReferencePageWindow() {
  const [ref, setRef] = useState(() => initialReferencePageFromUrl());

  useEffect(() => {
    const un = listenReferencePage(setRef);
    return () => { un.then((f) => f()).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (ref) document.title = `Foundation — ${ref.title}`;
  }, [ref]);

  if (!ref) {
    return <div className="refpage-window"><div className="pane-empty">No page to show.</div></div>;
  }

  // view=FitH so the page lands at a readable width rather than zoomed out.
  const src = `${ref.src}#page=${ref.page}&view=FitH`;
  return (
    <div className="refpage-window">
      <div className="refpage-header">
        <span className="refpage-title" title={ref.title}>{ref.title}</span>
        <span className="refpage-sub">Original page scan · p. {ref.page}</span>
      </div>
      <iframe className="refpage-frame" src={src} title={ref.title} />
    </div>
  );
}

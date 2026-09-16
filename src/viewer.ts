declare const growiFacade: any;

import {
  getDefaultStockPage,
  getCadConvertApi,
  resolveAttachmentUrl,
  toNumber,
  clamp,
  textColorForBg,
} from './common';

// ============================================================
// 表示(viewer)機能: 記法 :::custom-map を地図モーダルとして表示する。
// (元 client-entry.tsx の表示ロジックを、中身を変えずに移設)
// ============================================================

// ツリーを自前で深さ優先走査する(外部 unist-util-visit をバンドルしないことで、
// GROWI 本体の micromark/unified 環境とのバージョン不整合を避ける)。
const walk = (node: any, cb: (node: any) => void): void => {
  if (node == null) return;
  cb(node);
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    walk(child, cb);
  }
};

// desc(注意書き)付きマーカーのピンを点滅させる CSS を一度だけ注入する。
const ensureBlinkStyle = (): void => {
  const id = 'growi-custom-map-blink-style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
@keyframes growi-custom-map-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.growi-custom-map-pin-blink {
  animation: growi-custom-map-blink 1.2s ease-in-out infinite;
}`;
  document.head.appendChild(style);
};

// ==========================================
// 型定義
// ==========================================
interface MarkerData {
  x: number;
  y: number;
  label: string;
  photo: string;
  photoSrc: string;
  desc: string;
  color: string;
}

interface MapData {
  file: string;
  src: string;
  cx: number;
  cy: number;
  scale: number;
  restore: number;
  markers: MarkerData[];
  currentPagePath: string;
}

// 拡張子から CAD ファイルかどうかを判定する
const CAD_EXTENSIONS = ['.dxf', '.jww'];
const isCadFile = (fileName: string): boolean => {
  if (!fileName) return false;
  const lower = fileName.toLowerCase();
  return CAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

// ==========================================
// 描画された HTML 要素をボタンに変換するメインロジック
// ==========================================
const initMapPopups = (): void => {
  const elements = document.querySelectorAll(
    'div[data-plugin="custom-map"]:not([data-processed="true"])',
  );

  elements.forEach((el: Element) => {
    const htmlEl = el as HTMLElement;
    htmlEl.setAttribute('data-processed', 'true');

    let mapData: MapData;
    try {
      mapData = JSON.parse(htmlEl.getAttribute('data-map') || '{}');
    } catch (e) {
      console.error('Failed to parse custom-map data', e);
      return;
    }
    if (!mapData.file) return;

    if (!mapData.currentPagePath) {
      mapData.currentPagePath = (window as any).GROWI_CONTEXT?.page?.path || '';
    }

    const buttonText = htmlEl.getAttribute('data-link') || 'マップを開く';
    htmlEl.innerText = '';

    const button = document.createElement('button');
    button.className = 'btn btn-outline-primary m-1';
    button.type = 'button';
    button.innerText = buttonText;
    htmlEl.appendChild(button);

    button.addEventListener('click', (e) => {
      e.preventDefault();
      openMapModal(mapData).catch((err) => console.error('[custom-map] failed to open modal', err));
    });
  });
};

// 地図画像の候補ページ(探索順)を返す
const getMapCandidatePages = (mapData: MapData): string[] => {
  const pages: string[] = [];
  if (mapData.src) pages.push(mapData.src);
  pages.push(getDefaultStockPage());
  return Array.from(new Set(pages));
};

// マーカー写真の候補ページ(探索順)を返す
const getPhotoCandidatePages = (mapData: MapData, marker: MarkerData): string[] => {
  const pages: string[] = [];
  if (marker.photoSrc) pages.push(marker.photoSrc);
  if (mapData.currentPagePath) pages.push(mapData.currentPagePath);
  pages.push(...getMapCandidatePages(mapData));
  return Array.from(new Set(pages.filter(Boolean)));
};

// CAD 変換 API に問い合わせて、変換済み画像 URL を得る。
const resolveCadImageUrl = async (mapData: MapData): Promise<string | null> => {
  const api = getCadConvertApi();
  if (!api) return null;

  const src = mapData.src || getDefaultStockPage();
  try {
    const sep = api.includes('?') ? '&' : '?';
    const url = `${api}${sep}file=${encodeURIComponent(mapData.file)}&src=${encodeURIComponent(src)}`;
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`cad convert api failed: ${res.status}`);
    const data = await res.json();
    const imageUrl = data?.imageUrl || data?.url;
    if (data?.status && data.status !== 'ok') {
      throw new Error(`cad convert api status: ${data.status}`);
    }
    return typeof imageUrl === 'string' && imageUrl ? imageUrl : null;
  } catch (e) {
    console.warn('[custom-map] CAD conversion unavailable, falling back to attachment', e);
    return null;
  }
};

// 地図画像の URL を解決する。
const resolveMapImageUrl = async (mapData: MapData): Promise<string> => {
  if (isCadFile(mapData.file)) {
    const cadUrl = await resolveCadImageUrl(mapData);
    if (cadUrl) return cadUrl;
  }
  const attachmentUrl = await resolveAttachmentUrl(mapData.file, getMapCandidatePages(mapData));
  return attachmentUrl || `/images/maps/${mapData.file}`;
};

// ==========================================
// モーダルの生成と各種インタラクション
// ==========================================
const openMapModal = async (mapData: MapData): Promise<void> => {
  const oldModal = document.getElementById('growi-custom-map-modal');
  if (oldModal) oldModal.remove();

  const imageUrl = await resolveMapImageUrl(mapData);

  const modal = document.createElement('div');
  modal.id = 'growi-custom-map-modal';
  Object.assign(modal.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
    justifyContent: 'center', alignItems: 'center', zIndex: '9999',
  });

  const content = document.createElement('div');
  Object.assign(content.style, {
    position: 'relative', backgroundColor: '#fff', padding: '20px', borderRadius: '8px',
    maxWidth: '90vw', maxHeight: '90vh', boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
  });
  content.addEventListener('click', (ae) => ae.stopPropagation());

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    position: 'absolute', top: '-15px', right: '-15px', background: '#000', color: '#fff',
    border: 'none', borderRadius: '50%', width: '30px', height: '30px', fontSize: '20px',
    cursor: 'pointer', zIndex: '10', display: 'flex',
    justifyContent: 'center', alignItems: 'center',
  });
  closeBtn.addEventListener('click', () => modal.remove());

  const viewport = document.createElement('div');
  Object.assign(viewport.style, {
    position: 'relative', overflow: 'hidden',
    width: 'min(80vw, 900px)', height: 'min(75vh, 675px)',
    cursor: 'grab', touchAction: 'none', backgroundColor: '#f0f0f0',
    borderRadius: '4px',
  });

  const stage = document.createElement('div');
  Object.assign(stage.style, {
    position: 'absolute', top: '0', left: '0',
    transformOrigin: '0 0', willChange: 'transform',
  });

  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = mapData.file;
  Object.assign(img.style, { display: 'block', userSelect: 'none', pointerEvents: 'none' });
  img.draggable = false;
  stage.appendChild(img);

  const view = { scale: mapData.scale || 1, tx: 0, ty: 0 };
  let naturalW = 0;
  let naturalH = 0;
  const markerInners: HTMLElement[] = [];

  const applyTransform = (): void => {
    stage.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    const inv = view.scale ? 1 / view.scale : 1;
    for (const inner of markerInners) {
      inner.style.transform = `translate(-50%, -50%) scale(${inv})`;
    }
  };

  img.addEventListener('load', () => {
    naturalW = img.naturalWidth;
    naturalH = img.naturalHeight;
    stage.style.width = `${naturalW}px`;
    stage.style.height = `${naturalH}px`;

    const vpW = viewport.clientWidth;
    const vpH = viewport.clientHeight;

    const fitScale = Math.min(vpW / naturalW, vpH / naturalH);
    const baseScale = fitScale * (mapData.scale || 1);
    view.scale = baseScale;

    const centerX = (mapData.cx / 100) * naturalW;
    const centerY = (mapData.cy / 100) * naturalH;
    view.tx = vpW / 2 - centerX * view.scale;
    view.ty = vpH / 2 - centerY * view.scale;

    applyTransform();
  });

  mapData.markers.forEach((marker) => {
    const inner = createMarker(stage, marker, mapData);
    markerInners.push(inner);
  });

  const pointers = new Map<number, { x: number; y: number }>();
  let panStartTx = 0;
  let panStartTy = 0;
  let panStartX = 0;
  let panStartY = 0;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let pinchStartTx = 0;
  let pinchStartTy = 0;
  let pinchCenter = { x: 0, y: 0 };

  const vpPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = viewport.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const beginPinch = (): void => {
    const pts = Array.from(pointers.values());
    const [a, b] = pts;
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    pinchStartScale = view.scale;
    pinchStartTx = view.tx;
    pinchStartTy = view.ty;
    const midClientX = (a.x + b.x) / 2;
    const midClientY = (a.y + b.y) / 2;
    pinchCenter = vpPoint(midClientX, midClientY);
  };

  viewport.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-map-marker]')) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { viewport.setPointerCapture(e.pointerId); } catch { /* noop */ }

    if (pointers.size === 1) {
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartTx = view.tx;
      panStartTy = view.ty;
      viewport.style.cursor = 'grabbing';
    } else if (pointers.size === 2) {
      beginPinch();
    }
  });

  viewport.addEventListener('pointermove', (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size >= 2) {
      const pts = Array.from(pointers.values());
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const factor = dist / pinchStartDist;
      const newScale = clamp(pinchStartScale * factor, 0.02, 40);
      const ratio = newScale / pinchStartScale;
      view.tx = pinchCenter.x - (pinchCenter.x - pinchStartTx) * ratio;
      view.ty = pinchCenter.y - (pinchCenter.y - pinchStartTy) * ratio;
      view.scale = newScale;
      applyTransform();
    } else if (pointers.size === 1) {
      view.tx = panStartTx + (e.clientX - panStartX);
      view.ty = panStartTy + (e.clientY - panStartY);
      applyTransform();
    }
  });

  const endPointer = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { viewport.releasePointerCapture(e.pointerId); } catch { /* noop */ }

    if (pointers.size === 1) {
      const [p] = Array.from(pointers.values());
      panStartX = p.x;
      panStartY = p.y;
      panStartTx = view.tx;
      panStartTy = view.ty;
      viewport.style.cursor = 'grabbing';
    } else if (pointers.size === 0) {
      viewport.style.cursor = 'grab';
    }
  };
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  viewport.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = clamp(view.scale * factor, 0.02, 40);
    const ratio = newScale / view.scale;

    view.tx = px - (px - view.tx) * ratio;
    view.ty = py - (py - view.ty) * ratio;
    view.scale = newScale;
    applyTransform();
  }, { passive: false });

  viewport.appendChild(stage);
  content.appendChild(closeBtn);
  content.appendChild(viewport);
  modal.appendChild(content);
  modal.addEventListener('click', () => modal.remove());

  document.body.appendChild(modal);
};

// ==========================================
// マーカー(ピン + ラベル)の生成
// ==========================================
const createMarker = (
  stage: HTMLElement,
  marker: MarkerData,
  mapData: MapData,
): HTMLElement => {
  const color = marker.color || '#ff3b30';
  const restoreSec = mapData.restore;

  const wrapper = document.createElement('div');
  wrapper.setAttribute('data-map-marker', 'true');
  Object.assign(wrapper.style, {
    position: 'absolute', left: `${marker.x}%`, top: `${marker.y}%`, zIndex: '5',
  });

  const inner = document.createElement('div');
  inner.setAttribute('data-marker-inner', 'true');
  Object.assign(inner.style, {
    position: 'relative',
    transformOrigin: 'center center',
    transform: 'translate(-50%, -50%)',
  });

  const hasDesc = !!(marker.desc && marker.desc.trim());

  const pin = document.createElement('div');
  Object.assign(pin.style, {
    position: 'relative', width: '12px', height: '12px', backgroundColor: color,
    border: '2px solid #fff', borderRadius: '50%',
    boxShadow: '0 1px 3px rgba(0,0,0,0.4)', cursor: 'pointer',
    transition: 'width 0.15s ease, height 0.15s ease, opacity 0.15s ease',
  });
  if (hasDesc) {
    ensureBlinkStyle();
    pin.classList.add('growi-custom-map-pin-blink');
  }

  const labelEl = document.createElement('div');
  labelEl.innerText = marker.label || '';
  Object.assign(labelEl.style, {
    position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
    backgroundColor: color, color: textColorForBg(color), padding: '4px 8px', borderRadius: '4px',
    fontSize: '12px', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    cursor: 'pointer', userSelect: 'none', transition: 'opacity 0.15s ease',
  });

  let minimized = false;
  let restoreTimer: number | undefined;

  const minimize = (): void => {
    minimized = true;
    ensureBlinkStyle();
    pin.classList.add('growi-custom-map-pin-blink');
    Object.assign(pin.style, { width: '12px', height: '12px', borderWidth: '2px', opacity: '1' });
    if (marker.label) labelEl.style.display = 'none';

    if (restoreTimer) window.clearTimeout(restoreTimer);
    restoreTimer = window.setTimeout(restore, (restoreSec || 15) * 1000);
  };

  const restore = (): void => {
    minimized = false;
    Object.assign(pin.style, { width: '12px', height: '12px', borderWidth: '2px', opacity: '1' });
    if (hasDesc) pin.classList.add('growi-custom-map-pin-blink');
    else pin.classList.remove('growi-custom-map-pin-blink');
    if (marker.label) labelEl.style.display = '';
    if (restoreTimer) {
      window.clearTimeout(restoreTimer);
      restoreTimer = undefined;
    }
  };

  const toggleMinimize = (): void => {
    if (minimized) restore();
    else minimize();
  };

  const showDetail = (): void => {
    if (!marker.photo && !hasDesc) return;
    if (!marker.photo) {
      openDetailPopup('', marker.label, marker.desc);
      return;
    }
    resolveAttachmentUrl(marker.photo, getPhotoCandidatePages(mapData, marker))
      .then((url) => {
        openDetailPopup(url || `/images/maps/${marker.photo}`, marker.label, marker.desc);
      })
      .catch((err) => {
        console.error('[custom-map] failed to resolve photo', marker.photo, err);
        openDetailPopup(`/images/maps/${marker.photo}`, marker.label, marker.desc);
      });
  };

  const attachInteractions = (elForActions: HTMLElement): void => {
    elForActions.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showDetail();
    });

    let longPressTimer: number | undefined;
    let longPressed = false;
    let downPos = { x: 0, y: 0 };
    const MOVE_THRESHOLD = 10;

    elForActions.addEventListener('pointerdown', (e: PointerEvent) => {
      e.stopPropagation();
      longPressed = false;
      downPos = { x: e.clientX, y: e.clientY };

      if (e.pointerType === 'touch') {
        if (longPressTimer) window.clearTimeout(longPressTimer);
        longPressTimer = window.setTimeout(() => {
          longPressed = true;
          showDetail();
        }, 500);
      }
    });

    elForActions.addEventListener('pointermove', (e: PointerEvent) => {
      if (longPressTimer == null) return;
      const dx = Math.abs(e.clientX - downPos.x);
      const dy = Math.abs(e.clientY - downPos.y);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
    });

    elForActions.addEventListener('pointerup', (e: PointerEvent) => {
      e.stopPropagation();
      if (longPressTimer) {
        window.clearTimeout(longPressTimer);
        longPressTimer = undefined;
      }
      if (longPressed) {
        longPressed = false;
        return;
      }
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      toggleMinimize();
    });

    elForActions.addEventListener('click', (e) => e.stopPropagation());
  };

  attachInteractions(pin);

  if (marker.label) {
    attachInteractions(labelEl);
    inner.appendChild(labelEl);
  }

  inner.appendChild(pin);
  wrapper.appendChild(inner);
  stage.appendChild(wrapper);

  return inner;
};

// ==========================================
// マーカー詳細のポップアップ
// ==========================================
const openDetailPopup = (photoUrl: string, caption: string, desc: string): void => {
  const old = document.getElementById('growi-custom-map-photo');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'growi-custom-map-photo';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex',
    flexDirection: 'column', justifyContent: 'center', alignItems: 'center', zIndex: '10000',
  });

  if (photoUrl) {
    const photo = document.createElement('img');
    photo.src = photoUrl;
    photo.alt = caption || '';
    Object.assign(photo.style, {
      maxWidth: '85vw', maxHeight: '75vh', borderRadius: '6px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
    });
    overlay.appendChild(photo);
  }

  if (caption) {
    const cap = document.createElement('div');
    cap.innerText = caption;
    Object.assign(cap.style, {
      color: '#fff', marginTop: '12px', fontSize: '16px', fontWeight: 'bold',
      textAlign: 'center',
    });
    overlay.appendChild(cap);
  }

  if (desc && desc.trim()) {
    const descEl = document.createElement('div');
    descEl.innerText = desc.split('|').join('\n');
    Object.assign(descEl.style, {
      color: '#fff', marginTop: '10px', fontSize: '14px', lineHeight: '1.6',
      textAlign: 'center', whiteSpace: 'pre-wrap', maxWidth: '85vw',
      background: 'rgba(255,255,255,0.08)', padding: '10px 16px', borderRadius: '6px',
    });
    overlay.appendChild(descEl);
  }

  overlay.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); overlay.remove(); });
  document.body.appendChild(overlay);
};

// ==========================================
// remark の定義(記法 → data 属性付き div)
// ==========================================
const KV_REGEX = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

const parseMarkerLine = (text: string): MarkerData | null => {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  KV_REGEX.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = KV_REGEX.exec(text)) !== null) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[key] = val;
  }
  if (attrs.x == null && attrs.y == null) return null;
  return {
    x: toNumber(attrs.x, 50),
    y: toNumber(attrs.y, 50),
    label: attrs.label || '',
    photo: attrs.photo || '',
    photoSrc: attrs.photoSrc || attrs.photosrc || '',
    desc: attrs.desc || '',
    color: attrs.color || '#ff3b30',
  };
};

const extractTextFromNode = (node: any): string => {
  if (node == null) return '';
  if (typeof node.value === 'string' && (node.type === 'text' || node.type === 'inlineCode')) {
    return node.value;
  }
  let text = '';
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    text += extractTextFromNode(child);
  }
  return text;
};

const collectListItems = (node: any, out: any[]): void => {
  if (node == null) return;
  if (node.type === 'listItem') out.push(node);
  const children = Array.isArray(node.children) ? node.children : [];
  for (const child of children) {
    collectListItems(child, out);
  }
};

const buildMapData = (node: any): MapData => {
  const attributes = node.attributes || {};
  const markers: MarkerData[] = [];

  const listItems: any[] = [];
  collectListItems(node, listItems);
  for (const listItem of listItems) {
    const line = extractTextFromNode(listItem).trim();
    const marker = parseMarkerLine(line);
    if (marker) markers.push(marker);
  }

  return {
    file: attributes.file || '',
    src: attributes.src || '',
    cx: toNumber(attributes.cx, 50),
    cy: toNumber(attributes.cy, 50),
    scale: toNumber(attributes.scale, 1),
    restore: toNumber(attributes.restore, 15),
    markers,
    currentPagePath: '',
  };
};

// 画面更新の監視インターバル(deactivate で止められるよう保持)
let popupIntervalId: number | undefined;

export const activateViewer = (): void => {
  // レンダリング後の div をボタン化する定期監視
  if (popupIntervalId == null && typeof window !== 'undefined') {
    popupIntervalId = window.setInterval(initMapPopups, 1000);
  }

  if (
    typeof growiFacade === 'undefined'
    || growiFacade == null
    || growiFacade.markdownRenderer == null
  ) {
    return;
  }

  const { optionsGenerators } = growiFacade.markdownRenderer;
  const original = optionsGenerators.customGenerateViewOptions;

  optionsGenerators.customGenerateViewOptions = (...args: any[]) => {
    const options = original
      ? original(...args)
      : optionsGenerators.generateViewOptions(...args);

    options.remarkPlugins = options.remarkPlugins || [];

    options.remarkPlugins.push(() => (tree: any) => {
      walk(tree, (node: any) => {
        if (node.type === 'containerDirective' && node.name === 'custom-map') {
          const mapData = buildMapData(node);
          node.children = [];
          const data = node.data || (node.data = {});
          data.hName = 'div';
          data.hProperties = {
            'data-plugin': 'custom-map',
            'data-link': (node.attributes || {}).link || 'マップを開く',
            'data-map': JSON.stringify(mapData),
          };
        }
      });
    });

    return options;
  };
};

export const deactivateViewer = (): void => {
  if (popupIntervalId != null) {
    window.clearInterval(popupIntervalId);
    popupIntervalId = undefined;
  }
};

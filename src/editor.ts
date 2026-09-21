import {
  getDefaultStockPage,
  getCadConvertApi,
  resolveCurrentPagePath,
  fetchRegisteredAssets,
  resolveRegisteredAssetUrl,
  getPageIdByPath,
  getPageBodyById,
  updatePageBody,
  uploadAttachment,
  normalizeForSearch,
  toNumber,
  clamp,
  textColorForBg,
  PIN_SIZE_DEFAULT, PIN_SIZE_MIN, PIN_SIZE_MAX,
  LABEL_SIZE_DEFAULT, LABEL_SIZE_MIN, LABEL_SIZE_MAX,
  type RegisteredAsset,
} from './common';

// ============================================================
// 編集(editor)機能: 編集画面にフローティングボタンを出し、GUI で平面図に
// マーカーを配置して :::custom-map 記法を生成・カーソル位置に挿入する。
// (元 growi-plugin-custom-map-editor の client-entry.tsx を移設。共通部は
//  common.ts から import し、editor 固有ロジックのみをここに置く)
// ============================================================

const BTN_ID = 'growi-custom-map-editor-fab';
const EDIT_BTN_ID = 'growi-custom-map-editor-edit-fab';
const MODAL_ID = 'growi-custom-map-editor-modal';

// ============================================================
// 編集用データモデル(表示プラグインの記法に対応)
// ============================================================
// 1 マーカーに紐づく参考写真 1 枚。photo は添付ファイル名、desc はその写真のコメント。
interface EditorPhoto {
  photo: string;
  desc: string;
}

interface EditorMarker {
  x: number;
  y: number;
  label: string;
  color: string;
  desc: string; // マーカー全体の説明/注意(写真ごとの desc とは別)
  photos: EditorPhoto[]; // 参考写真(0 枚以上)。記法では子リストで表現する
}

interface EditorMapSettings {
  file: string;
  src: string;
  cx: number;
  cy: number;
  scale: number;
  link: string;
  restore: number;
  rotate: number;
  pinSize: number; // ピン径(px)。マップ全体共通
  labelSize: number; // ラベル文字サイズ(px)。マップ全体共通
}

// 回転角を 0/90/180/270 のいずれかに正規化する。
const normalizeRotate = (deg: number): number => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

const DEFAULT_MARKER_COLOR = '#ff3b30';

// マーカー色のプリセット(パレット表示用)
const PRESET_COLORS = [
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#5ac8fa', '#007aff',
  '#af52de', '#ff2d55', '#000000', '#8e8e93', '#ffffff',
];

const round1 = (v: number): number => Math.round(v * 10) / 10;

// 文字列属性を key="value" 形式にする。値内のダブルクォートは退避。
const attrStr = (key: string, value: string): string => `${key}="${value.replace(/"/g, '\\"')}"`;

// EditorMapSettings + markers から :::custom-map 記法を生成する。
const buildCustomMapSnippet = (settings: EditorMapSettings, markers: EditorMarker[]): string => {
  const attrs: string[] = [attrStr('file', settings.file)];
  if (settings.src) attrs.push(attrStr('src', settings.src));
  if (settings.cx !== 50) attrs.push(`cx="${round1(settings.cx)}"`);
  if (settings.cy !== 50) attrs.push(`cy="${round1(settings.cy)}"`);
  if (settings.scale !== 1) attrs.push(`scale="${settings.scale}"`);
  if (settings.rotate) attrs.push(`rotate="${normalizeRotate(settings.rotate)}"`);
  if (settings.link && settings.link !== 'マップを開く') attrs.push(attrStr('link', settings.link));
  if (settings.restore !== 15) attrs.push(`restore="${settings.restore}"`);
  if (settings.pinSize !== PIN_SIZE_DEFAULT) attrs.push(`pinSize="${round1(settings.pinSize)}"`);
  if (settings.labelSize !== LABEL_SIZE_DEFAULT) attrs.push(`labelSize="${round1(settings.labelSize)}"`);

  const lines: string[] = [];
  lines.push(`:::custom-map{${attrs.join(' ')}}`);

  for (const m of markers) {
    const parts: string[] = [`x=${round1(m.x)}`, `y=${round1(m.y)}`];
    if (m.label) parts.push(attrStr('label', m.label));
    if (m.color && m.color.toLowerCase() !== DEFAULT_MARKER_COLOR) parts.push(attrStr('color', m.color));
    if (m.desc) parts.push(attrStr('desc', m.desc));
    lines.push(`- ${parts.join(' ')}`);

    // 参考写真は 2 スペースインデントの子リストで 1 枚 1 行。番号を使わないので
    // 手編集での削除・挿入・並び替えが行単位で完結する。
    for (const p of m.photos) {
      if (!p.photo) continue;
      const photoParts: string[] = [attrStr('photo', p.photo)];
      if (p.desc) photoParts.push(attrStr('desc', p.desc));
      lines.push(`  - ${photoParts.join(' ')}`);
    }
  }

  lines.push(':::');
  return `\n${lines.join('\n')}\n`;
};

// ============================================================
// 既存記法のパース(再編集用): 本文テキストから :::custom-map ブロックを抽出し、
// EditorMapSettings / EditorMarker に逆変換する。buildCustomMapSnippet の逆操作。
// ============================================================

// key="value" / key='value' / key=value を拾う。値内の \" は後で復元する。
const KV_REGEX = /(\w+)\s*=\s*(?:"((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|(\S+))/g;

// エスケープされた \" \' を元に戻す(attrStr の逆)。
const unescapeAttr = (s: string): string => s.replace(/\\(["'])/g, '$1');

// 属性文字列(key=value...)を辞書化する。
const parseAttrs = (text: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  KV_REGEX.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = KV_REGEX.exec(text)) !== null) {
    const key = m[1];
    const raw = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[key] = unescapeAttr(raw);
  }
  return attrs;
};

// マーカー行(- x=.. y=.. ...)1 本を EditorMarker に変換。x/y が無ければ null。
// photos は空で返し、後続の子リスト行を呼び出し側で push する。
// 後方互換: 旧記法で同じ行に photo= があれば写真 1 枚として取り込む
// (desc はマーカー説明。旧仕様では写真コメントとマーカー説明が同一だった)。
const parseMarkerLineToEditor = (line: string): EditorMarker | null => {
  const attrs = parseAttrs(line);
  if (attrs.x == null && attrs.y == null) return null;
  const photos: EditorPhoto[] = [];
  if (attrs.photo) photos.push({ photo: attrs.photo, desc: attrs.desc || '' });
  return {
    x: clamp(toNumber(attrs.x, 50), 0, 100),
    y: clamp(toNumber(attrs.y, 50), 0, 100),
    label: attrs.label || '',
    color: attrs.color || DEFAULT_MARKER_COLOR,
    desc: attrs.desc || '',
    photos,
  };
};

// 写真の子リスト行(  - photo=.. desc=..)1 本を EditorPhoto に変換。photo が無ければ null。
const parsePhotoLineToEditor = (line: string): EditorPhoto | null => {
  const attrs = parseAttrs(line);
  if (!attrs.photo) return null;
  return { photo: attrs.photo, desc: attrs.desc || '' };
};

// 行頭のリストマーカー(- / * / +)より前の空白量(インデント幅)を数える。
const listIndentWidth = (line: string): number => {
  const m = /^([ \t]*)[-*+]\s/.exec(line);
  if (!m) return -1; // リスト項目でない
  // タブは 4 相当で数える(通常は半角スペース運用)。
  return m[1].replace(/\t/g, '    ').length;
};

// 抽出した 1 ブロックを表す。raw は本文中の該当部分(置換対象)そのもの。
export interface CustomMapBlock {
  raw: string; // 本文中の該当ブロック全体(:::custom-map{..} .. ::: を含む)
  start: number; // 本文中の開始インデックス
  end: number; // 本文中の終了インデックス(排他)
  settings: EditorMapSettings;
  markers: EditorMarker[];
}

// 本文テキストから全ての :::custom-map{ ... } ... ::: ブロックを抽出する。
// フェンスは行頭の `:::custom-map{...}` から、行頭 `:::` までを 1 ブロックとする。
const CUSTOM_MAP_OPEN = /^:::custom-map\{([^}]*)\}[ \t]*$/;
const FENCE_CLOSE = /^:::[ \t]*$/;

const extractCustomMapBlocks = (bodyText: string): CustomMapBlock[] => {
  const blocks: CustomMapBlock[] = [];
  const lines = bodyText.split('\n');

  // 各行の本文中での開始オフセットを事前計算する(+1 は改行分)。
  const lineOffsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    lineOffsets.push(acc);
    acc += line.length + 1;
  }

  let i = 0;
  while (i < lines.length) {
    const open = CUSTOM_MAP_OPEN.exec(lines[i]);
    if (!open) { i += 1; continue; }

    // 閉じフェンスを探す。
    let j = i + 1;
    while (j < lines.length && !FENCE_CLOSE.test(lines[j])) j += 1;
    if (j >= lines.length) break; // 閉じが無ければ以降は対象外

    const attrs = parseAttrs(open[1]);
    const markers: EditorMarker[] = [];

    // まずブロック内のリスト項目行のインデント幅を調べ、最小インデントを
    // 「マーカー行の階層」とみなす。それより深いリスト項目は写真(子)とする。
    let baseIndent = Infinity;
    for (let k = i + 1; k < j; k += 1) {
      const w = listIndentWidth(lines[k]);
      if (w >= 0 && w < baseIndent) baseIndent = w;
    }
    if (!Number.isFinite(baseIndent)) baseIndent = 0;

    let current: EditorMarker | null = null;
    for (let k = i + 1; k < j; k += 1) {
      const w = listIndentWidth(lines[k]);
      if (w < 0) continue; // リスト項目でない行は無視
      if (w <= baseIndent) {
        // マーカー行(トップレベル)。
        const marker = parseMarkerLineToEditor(lines[k]);
        if (marker) {
          markers.push(marker);
          current = marker;
        } else {
          current = null;
        }
      } else if (current) {
        // 写真行(子リスト)。直前のマーカーに紐づける。
        const photo = parsePhotoLineToEditor(lines[k]);
        if (photo) current.photos.push(photo);
      }
    }

    const settings: EditorMapSettings = {
      file: attrs.file || '',
      src: attrs.src || '',
      cx: toNumber(attrs.cx, 50),
      cy: toNumber(attrs.cy, 50),
      scale: toNumber(attrs.scale, 1),
      link: attrs.link || 'マップを開く',
      restore: toNumber(attrs.restore, 15),
      rotate: normalizeRotate(toNumber(attrs.rotate, 0)),
      pinSize: clamp(toNumber(attrs.pinSize, PIN_SIZE_DEFAULT), PIN_SIZE_MIN, PIN_SIZE_MAX),
      labelSize: clamp(toNumber(attrs.labelSize, LABEL_SIZE_DEFAULT), LABEL_SIZE_MIN, LABEL_SIZE_MAX),
    };

    const start = lineOffsets[i];
    // ブロック末尾(閉じフェンス行の行末)までを範囲とする。
    const end = lineOffsets[j] + lines[j].length;
    blocks.push({
      raw: bodyText.slice(start, end),
      start,
      end,
      settings,
      markers,
    });

    i = j + 1;
  }

  return blocks;
};

// ------------------------------------------------------------
// 編集画面かどうかを判定する。
//   1. URL のハッシュに #edit が含まれる
//   2. .cm-editor が可視(高さ > 0)
// ------------------------------------------------------------
const findEditor = (): HTMLElement | null => document.querySelector<HTMLElement>('.cm-editor');
const findEditorContent = (): HTMLElement | null => document.querySelector<HTMLElement>('.cm-content');

const isEditing = (): boolean => {
  const hashEdit = window.location.hash.includes('edit');
  if (!hashEdit) return false;
  const ed = findEditor();
  if (!ed) return false;
  return ed.getBoundingClientRect().height > 0;
};

// ------------------------------------------------------------
// カーソル位置の保存/復元(DOM Selection 方式)。
// ------------------------------------------------------------
let savedRange: Range | null = null;

const saveEditorSelection = (): void => {
  savedRange = null;
  const content = findEditorContent();
  if (!content) {
    console.log('[custom-map-editor] .cm-content なし(保存スキップ)');
    return;
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    if (content.contains(range.commonAncestorContainer)) {
      savedRange = range.cloneRange();
      console.log('[custom-map-editor] カーソル位置(Range)を保存');
      return;
    }
  }
  console.log('[custom-map-editor] エディタ内にカーソルなし(末尾へ挿入予定)');
};

const insertTextAtCursor = (text: string): boolean => {
  const content = findEditorContent();
  if (!content) {
    console.warn('[custom-map-editor] .cm-content が見つかりません');
    return false;
  }
  content.focus();

  if (savedRange) {
    try {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
        console.log('[custom-map-editor] カーソル位置(Range)を復元');
      }
    } catch (e) {
      console.warn('[custom-map-editor] Range 復元失敗(現在位置に挿入)', e);
    }
  }

  try {
    const ok = document.execCommand('insertText', false, text);
    if (ok) {
      console.log('[custom-map-editor] execCommand insertText で挿入成功');
      return true;
    }
  } catch (e) {
    console.warn('[custom-map-editor] execCommand 失敗', e);
  }
  return false;
};

// カーソルが既存の :::custom-map ブロックの内側にあるかを、DOM 上の行
// (.cm-line)を上方向に辿って判定する。直近上方で custom-map の開始フェンスに
// 先に当たれば「内側」。閉じフェンス :::(custom-map 開始でない) に先に当たれば
// 「外側」。設計方針: 記法の中に新規記法を挿入すると構成を壊すため、
// custom-map ブロック内での新規作成は止めて再編集を促す。
// 注: CodeMirror6 の仮想スクロールで上方行が DOM に無い場合は判定できず false
// (＝内側でない扱い)を返す。カーソル周辺行は描画されているため実用上は機能する。
const isCursorInsideCustomMap = (): boolean => {
  const content = findEditorContent();
  if (!content) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;

  // カーソルのある行要素(.cm-line)を特定する。
  let node: Node | null = sel.getRangeAt(0).startContainer;
  let lineEl: HTMLElement | null = null;
  while (node && node !== content) {
    if (node instanceof HTMLElement && node.classList.contains('cm-line')) {
      lineEl = node;
      break;
    }
    node = node.parentNode;
  }
  if (!lineEl) return false;

  // カーソル行を含め、上方向に .cm-line を辿る。
  const openRe = /^:::custom-map\{/;
  const fenceRe = /^:::/;
  let el: HTMLElement | null = lineEl;
  // カーソル行自身が開始フェンスなら内側とみなす。
  while (el) {
    const text = (el.textContent || '').trim();
    if (openRe.test(text)) return true; // custom-map の開始に先に当たった=内側
    if (fenceRe.test(text) && el !== lineEl) return false; // 別の閉じ/開始フェンス=外側
    el = el.previousElementSibling as HTMLElement | null;
    if (el && !el.classList.contains('cm-line')) el = null;
  }
  return false;
};

const copyToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    console.log('[custom-map-editor] クリップボードにコピーしました');
    showToast('記法をクリップボードにコピーしました。カーソル位置に貼り付けてください。');
  } catch (e) {
    console.warn('[custom-map-editor] クリップボードコピー失敗', e);
  }
};

const showToast = (message: string, isError = false): void => {
  const toast = document.createElement('div');
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
    background: isError ? 'rgba(176,0,32,0.92)' : 'rgba(0,0,0,0.85)', color: '#fff',
    padding: '10px 16px', borderRadius: '6px', fontSize: '13px', zIndex: '100000',
    maxWidth: '80vw', textAlign: 'center', pointerEvents: 'none',
  });
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), isError ? 4000 : 3000);
};

// ============================================================
// GUI モーダル
// ============================================================
const createModalShell = (
  title: string,
  closeOnBackdrop = true,
): { overlay: HTMLElement; card: HTMLElement; body: HTMLElement } => {
  const old = document.getElementById(MODAL_ID);
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: '100000',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'relative', backgroundColor: '#fff', borderRadius: '8px',
    width: 'min(92vw, 960px)', maxHeight: '88vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 10px 30px rgba(0,0,0,0.4)', overflow: 'hidden',
  });
  card.addEventListener('click', (e) => e.stopPropagation());

  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid #e5e5e5', flex: '0 0 auto',
  });
  const titleEl = document.createElement('div');
  titleEl.textContent = title;
  Object.assign(titleEl.style, { fontWeight: 'bold', fontSize: '15px' });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer',
    lineHeight: '1', color: '#666',
  });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  Object.assign(body.style, { padding: '16px', overflow: 'auto', flex: '1 1 auto' });

  card.appendChild(header);
  card.appendChild(body);
  overlay.appendChild(card);
  if (closeOnBackdrop) {
    overlay.addEventListener('click', () => overlay.remove());
  }
  document.body.appendChild(overlay);

  return { overlay, card, body };
};

// 登録アセット(API 登録済みの地図)の一覧モーダル。
// 設計方針: 一般ページ編集者は media-library を直接参照できないため、GUI の
// 平面図選択は「API に登録済みの地図アセット(GET /assets)」からのみ行う。
// media-library の生ファイルは選択肢に出さない(記法直書きも今後不許可)。
// 現在表示中ページの pageId を解決する。ID ベース URL ならそのまま、
// パスベースなら getPageIdByPath で引く。解決できなければ null。
const resolveCurrentPageId = async (): Promise<string | null> => {
  const raw = typeof location !== 'undefined' ? location.pathname.replace(/^\//, '') : '';
  const seg = raw.split('/')[0] || '';
  if (/^[0-9a-f]{24}$/i.test(seg)) return seg;
  const path = await resolveCurrentPagePath();
  if (!path) return null;
  return getPageIdByPath(path);
};

// ------------------------------------------------------------
// 「地図を編集」モーダル: ページ本文中の :::custom-map ブロックを一覧表示し、
// 選んで再編集する。本文は保存済みリビジョン(GET /_api/v3/page)から取得し、
// 確定時に該当ブロックだけ差し替えて保存(PUT)する。
// 設計: 一般編集者は登録アセット経由のみ。旧生ファイル名の記法は解決できない
// ため、その旨を表示して編集不可にする(新方式で入れ直す運用)。
// ------------------------------------------------------------
const openEditListModal = async (): Promise<void> => {
  const { body } = createModalShell('地図を編集（このページ内の地図）');

  const loading = document.createElement('div');
  loading.textContent = '読み込み中...';
  Object.assign(loading.style, { color: '#666', padding: '20px', textAlign: 'center' });
  body.appendChild(loading);

  // 現在ページの pageId と 本文を取得する。
  const pageId = await resolveCurrentPageId();
  if (!pageId) {
    loading.remove();
    const err = document.createElement('div');
    err.textContent = 'このページの情報を取得できませんでした。';
    Object.assign(err.style, { color: '#b00020', padding: '20px', textAlign: 'center', fontSize: '13px' });
    body.appendChild(err);
    return;
  }

  const pageBody = await getPageBodyById(pageId);
  if (!pageBody) {
    loading.remove();
    const err = document.createElement('div');
    err.textContent = 'ページ本文を取得できませんでした。一度ページを保存してからお試しください。';
    Object.assign(err.style, { color: '#b00020', padding: '20px', textAlign: 'center', fontSize: '13px' });
    body.appendChild(err);
    return;
  }

  const blocks = extractCustomMapBlocks(pageBody.body);
  loading.remove();

  const note = document.createElement('div');
  note.innerHTML = 'このページ内の地図を選んで編集できます。'
    + '<br><b>注意:</b> 編集を保存するとページが再読み込みされます。未保存の編集がある場合は先に保存してください。';
  Object.assign(note.style, { fontSize: '12px', color: '#666', marginBottom: '10px', lineHeight: '1.6' });
  body.appendChild(note);

  if (blocks.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'このページには編集できる地図（:::custom-map）がありません。';
    Object.assign(empty.style, { color: '#666', padding: '20px', textAlign: 'center' });
    body.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px',
  });
  body.appendChild(grid);

  // 各ブロックのプレビューを作る。file が登録アセットなら imageUrl を解決して
  // サムネイル表示。解決できなければ「登録アセットではない」として編集不可にする。
  blocks.forEach((block, index) => {
    const cell = document.createElement('div');
    Object.assign(cell.style, {
      display: 'flex', flexDirection: 'column', gap: '6px',
      border: '1px solid #ddd', borderRadius: '6px', padding: '8px', background: '#fafafa',
    });

    const thumbWrap = document.createElement('div');
    Object.assign(thumbWrap.style, {
      width: '100%', height: '100px', background: '#fff', display: 'flex',
      justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
    });
    const thumb = document.createElement('img');
    thumb.loading = 'lazy';
    Object.assign(thumb.style, { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' });
    const thumbNote = document.createElement('div');
    Object.assign(thumbNote.style, { fontSize: '11px', color: '#999' });
    thumbNote.textContent = '読み込み中...';
    thumbWrap.appendChild(thumbNote);
    cell.appendChild(thumbWrap);

    const fileName = document.createElement('div');
    fileName.textContent = block.settings.file || '(file 未指定)';
    Object.assign(fileName.style, {
      fontSize: '12px', color: '#333', wordBreak: 'break-all', fontFamily: 'monospace', lineHeight: '1.3',
    });
    cell.appendChild(fileName);

    const meta = document.createElement('div');
    meta.textContent = `マーカー ${block.markers.length} 個${block.settings.rotate ? ` / 回転 ${block.settings.rotate}°` : ''}`;
    Object.assign(meta.style, { fontSize: '11px', color: '#888' });
    cell.appendChild(meta);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'この地図を編集';
    Object.assign(editBtn.style, {
      background: '#0d6efd', color: '#fff', border: 'none', borderRadius: '4px',
      padding: '6px', cursor: 'pointer', fontSize: '12px',
    });
    cell.appendChild(editBtn);

    grid.appendChild(cell);

    // 登録アセットの imageUrl を解決してプレビュー＋編集可否を決める。
    resolveRegisteredAssetUrl(block.settings.file, [pageBody.path, getDefaultStockPage()])
      .then((url) => {
        if (url) {
          thumbNote.remove();
          thumb.src = url;
          thumbWrap.appendChild(thumb);
          editBtn.addEventListener('click', () => {
            openMapPreviewModal({
              imageUrl: url,
              initialSettings: block.settings,
              initialMarkers: block.markers,
              editContext: {
                pageId,
                revisionId: pageBody.revisionId,
                fullBody: pageBody.body,
                block,
              },
            });
          });
        } else {
          // 登録アセットでない(旧生ファイル名など)。編集対象外にする。
          thumbNote.textContent = '登録アセットではありません';
          editBtn.disabled = true;
          Object.assign(editBtn.style, { background: '#ccc', cursor: 'not-allowed' });
          editBtn.textContent = '編集できません';
          const hint = document.createElement('div');
          hint.textContent = 'この地図は登録アセットではないため編集できません。新方式で登録・作成し直してください。';
          Object.assign(hint.style, { fontSize: '10px', color: '#b00020', lineHeight: '1.4' });
          cell.appendChild(hint);
        }
      })
      .catch(() => {
        thumbNote.textContent = 'プレビュー取得失敗';
      });
  });
};

const openImageListModal = async (): Promise<void> => {
  const { body } = createModalShell('地図を選択（登録済みアセット）');

  // 変換 API(cadConvertApi)未設定だと登録アセットを取得できない。
  // このお手軽運用では、画像をこのページ(既定 media-library)の添付として置き、
  // 記法に file="添付ファイル名" を手書きする運用になる。
  if (!getCadConvertApi()) {
    const note = document.createElement('div');
    note.innerHTML = '地図アセット API（cadConvertApi）が設定されていません。'
      + '<br><br>API なしのお手軽運用では、地図画像をページの添付として保存し、'
      + '記法に <code style="font-family:monospace;background:#f2f2f2;padding:1px 4px;border-radius:3px;">file="添付ファイル名"</code> を直接指定してください。'
      + '<br>この場合、画像を置いたページ（既定 media-library）は閲覧できる状態にしておく必要があります。';
    Object.assign(note.style, { color: '#664d03', padding: '20px', fontSize: '13px', lineHeight: '1.7' });
    body.appendChild(note);
    return;
  }

  const info = document.createElement('div');
  info.textContent = 'MAP 編集者が登録した地図から選びます。ここに無い図面は、MAP 編集者に登録を依頼してください。';
  Object.assign(info.style, { fontSize: '12px', color: '#666', marginBottom: '10px', lineHeight: '1.6' });
  body.appendChild(info);

  // 検索ボックス(登録名・元ファイル名で絞り込み)
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '登録名・元ファイル名で絞り込み...';
  Object.assign(search.style, {
    width: '100%', padding: '6px 8px', boxSizing: 'border-box', fontSize: '13px',
    marginBottom: '10px', border: '1px solid #ccc', borderRadius: '4px',
  });
  body.appendChild(search);

  const loading = document.createElement('div');
  loading.textContent = '読み込み中...';
  Object.assign(loading.style, { color: '#666', padding: '20px', textAlign: 'center' });
  body.appendChild(loading);

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px',
  });
  body.appendChild(grid);

  let assets: RegisteredAsset[] = [];
  try {
    // src 省略で全登録アセットを取得(登録は media-library 由来だが、一般編集者は
    // その閲覧権限が無くても GET /assets 自体は認証不要で叩ける)。
    assets = await fetchRegisteredAssets();
  } catch (e) {
    console.error('[custom-map-editor] registered assets fetch error', e);
    loading.remove();
    const err = document.createElement('div');
    err.textContent = '登録アセットの取得に失敗しました。API サーバーの稼働状況を確認してください。';
    Object.assign(err.style, { color: '#b00020', padding: '20px', textAlign: 'center', fontSize: '13px' });
    body.appendChild(err);
    return;
  }
  loading.remove();

  if (assets.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = '登録済みの地図がありません。MAP 編集者が「地図アセットの登録」から登録すると、ここに表示されます。';
    Object.assign(empty.style, { color: '#666', padding: '20px', textAlign: 'center' });
    body.appendChild(empty);
    return;
  }

  const buildCell = (asset: RegisteredAsset): HTMLElement => {
    const cell = document.createElement('button');
    cell.type = 'button';
    Object.assign(cell.style, {
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
      border: '1px solid #ddd', borderRadius: '6px', padding: '8px', background: '#fafafa',
      cursor: 'pointer',
    });

    const thumb = document.createElement('img');
    thumb.src = asset.imageUrl;
    thumb.alt = asset.name;
    thumb.loading = 'lazy';
    Object.assign(thumb.style, {
      width: '100%', height: '100px', objectFit: 'contain', background: '#fff',
    });

    const name = document.createElement('div');
    name.textContent = asset.name;
    Object.assign(name.style, {
      fontSize: '12px', color: '#333', wordBreak: 'break-all', textAlign: 'center',
      lineHeight: '1.3', maxHeight: '2.6em', overflow: 'hidden', fontFamily: 'monospace',
    });

    const meta = document.createElement('div');
    meta.textContent = asset.type === 'image' ? '画像' : `CAD / ${asset.rotate}°`;
    Object.assign(meta.style, { fontSize: '10px', color: '#999' });

    cell.appendChild(thumb);
    cell.appendChild(name);
    cell.appendChild(meta);
    cell.addEventListener('click', () => openMapPreviewModal({
      imageUrl: asset.imageUrl,
      initialSettings: {
        file: asset.name, src: '', cx: 50, cy: 50, scale: 1, link: 'マップを開く', restore: 15, rotate: 0,
        pinSize: PIN_SIZE_DEFAULT, labelSize: LABEL_SIZE_DEFAULT,
      },
    }));
    return cell;
  };

  const render = (filter: string): void => {
    grid.innerHTML = '';
    const kw = normalizeForSearch(filter.trim());
    const shown = assets.filter((a) => !kw
      || normalizeForSearch(a.name).includes(kw)
      || normalizeForSearch(a.srcFile || '').includes(kw));
    if (shown.length === 0) {
      const none = document.createElement('div');
      none.textContent = '該当する登録がありません。';
      Object.assign(none.style, { color: '#888', padding: '12px', gridColumn: '1 / -1', textAlign: 'center', fontSize: '12px' });
      grid.appendChild(none);
      return;
    }
    for (const asset of shown) grid.appendChild(buildCell(asset));
  };

  render('');
  search.addEventListener('input', () => render(search.value));
};

// 既存記法の再編集で使う、置換対象ブロックの文脈。
interface EditContext {
  pageId: string;
  revisionId: string;
  fullBody: string; // ページ本文全体(この中の block を置換する)
  block: CustomMapBlock; // 置換対象ブロック
}

// ------------------------------------------------------------
// 参考写真の切り抜き(矩形トリミング)モーダル。
// アップロード前に元画像を表示し、ドラッグで矩形範囲を選択させる。
// 範囲を選べばその領域を JPEG(画質0.9)で切り出して onDone に渡す。
// 範囲未選択(または極小)なら元ファイルをそのまま渡す。回転なし・自由矩形・依存追加なし。
// ------------------------------------------------------------
const openCropModal = (file: File, onDone: (result: File) => void): void => {
  // 写真編集モーダル(MODAL_ID)の上に重ねるため、専用オーバーレイを自前で作る
  // (createModalShell は MODAL_ID を使い回すので下のモーダルを消してしまう)。
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: '100001',
  });
  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'relative', backgroundColor: '#fff', borderRadius: '8px',
    width: 'min(92vw, 820px)', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 10px 30px rgba(0,0,0,0.4)', overflow: 'hidden',
  });
  card.addEventListener('click', (e) => e.stopPropagation());
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid #e5e5e5', flex: '0 0 auto',
  });
  const titleEl = document.createElement('div');
  titleEl.textContent = '参考写真の切り抜き';
  Object.assign(titleEl.style, { fontWeight: 'bold', fontSize: '15px' });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.innerHTML = '&times;';
  Object.assign(closeBtn.style, {
    background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer',
    lineHeight: '1', color: '#666',
  });
  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  const body = document.createElement('div');
  Object.assign(body.style, {
    padding: '12px', overflow: 'auto', flex: '1 1 auto',
    display: 'flex', flexDirection: 'column', gap: '10px',
  });
  card.appendChild(header);
  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // クリーンアップ(objectUrl 解放 + オーバーレイ除去)を1箇所に集約。
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    URL.revokeObjectURL(objectUrl);
    overlay.remove();
  };
  // × と背景クリックで中止(アップロードしない)。
  closeBtn.addEventListener('click', () => cleanup());
  overlay.addEventListener('click', () => cleanup());

  const note = document.createElement('div');
  note.textContent = '画像上をドラッグして切り抜く範囲を選びます。選ばなければ画像全体を使います。';
  Object.assign(note.style, { fontSize: '12px', color: '#555' });
  body.appendChild(note);

  // 画像表示領域(canvas)。表示は縮小し、切り出しは元解像度で行う。
  const stage = document.createElement('div');
  Object.assign(stage.style, {
    position: 'relative', width: '100%', maxHeight: '60vh', overflow: 'auto',
    background: '#f2f2f2', display: 'flex', justifyContent: 'center', alignItems: 'center',
  });
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { display: 'block', touchAction: 'none', cursor: 'crosshair', maxWidth: '100%' });
  stage.appendChild(canvas);
  body.appendChild(stage);

  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = '選択をクリア';
  Object.assign(clearBtn.style, {
    background: '#f0f0f0', border: '1px solid #ccc', borderRadius: '4px',
    padding: '8px 12px', cursor: 'pointer', fontSize: '13px',
  });
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.textContent = '全体をアップロード';
  Object.assign(okBtn.style, {
    background: '#0d6efd', color: '#fff', border: 'none', borderRadius: '4px',
    padding: '8px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold',
  });
  btnRow.appendChild(clearBtn);
  btnRow.appendChild(okBtn);
  body.appendChild(btnRow);

  const img = new Image();
  const objectUrl = URL.createObjectURL(file);
  let naturalW = 0; let naturalH = 0;
  let dispScale = 1; // 表示canvas /元画像 の比率
  const ctx = canvas.getContext('2d');

  // 選択矩形(表示canvas座標)。null なら未選択。
  let sel: { x: number; y: number; w: number; h: number } | null = null;
  let dragging = false;
  let startX = 0; let startY = 0;

  const redraw = (): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (sel && sel.w > 0 && sel.h > 0) {
      // 選択外を暗くする。
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, canvas.width, sel.y); // 上
      ctx.fillRect(0, sel.y + sel.h, canvas.width, canvas.height - (sel.y + sel.h)); // 下
      ctx.fillRect(0, sel.y, sel.x, sel.h); // 左
      ctx.fillRect(sel.x + sel.w, sel.y, canvas.width - (sel.x + sel.w), sel.h); // 右
      // 枠線。
      ctx.strokeStyle = '#0d6efd';
      ctx.lineWidth = 2;
      ctx.strokeRect(sel.x + 1, sel.y + 1, sel.w - 2, sel.h - 2);
    }
  };

  const updateOkLabel = (): void => {
    okBtn.textContent = (sel && sel.w > 4 && sel.h > 4) ? 'この範囲をアップロード' : '全体をアップロード';
  };

  img.onload = (): void => {
    naturalW = img.naturalWidth;
    naturalH = img.naturalHeight;
    // 表示は最大幅 720px を目安に縮小(元は切り出し時に使う)。
    const maxW = Math.min(720, naturalW);
    dispScale = maxW / naturalW;
    canvas.width = Math.round(naturalW * dispScale);
    canvas.height = Math.round(naturalH * dispScale);
    redraw();
  };
  img.onerror = (): void => {
    // 画像として読めない場合は切り抜きを諦め、そのままアップロードに回す。
    cleanup();
    onDone(file);
  };
  img.src = objectUrl;

  const canvasPoint = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    // canvas は maxWidth:100% で表示縮小され得るので、実ピクセルへ換算する。
    const sx = canvas.width / r.width;
    const sy = canvas.height / r.height;
    return {
      x: clamp((e.clientX - r.left) * sx, 0, canvas.width),
      y: clamp((e.clientY - r.top) * sy, 0, canvas.height),
    };
  };

  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    const pt = canvasPoint(e);
    dragging = true;
    startX = pt.x; startY = pt.y;
    sel = { x: startX, y: startY, w: 0, h: 0 };
    try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
  });
  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    const pt = canvasPoint(e);
    const x = Math.min(startX, pt.x);
    const y = Math.min(startY, pt.y);
    sel = { x, y, w: Math.abs(pt.x - startX), h: Math.abs(pt.y - startY) };
    redraw();
    updateOkLabel();
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    updateOkLabel();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  clearBtn.addEventListener('click', () => { sel = null; redraw(); updateOkLabel(); });

  const finish = (result: File): void => {
    cleanup();
    onDone(result);
  };

  // 元ファイル名から JPEG の切り抜き名を作る(拡張子を .jpg に、_crop を付す)。
  const cropName = (): string => {
    const base = file.name.replace(/\.[^.]+$/, '');
    return `${base}_crop.jpg`;
  };

  okBtn.addEventListener('click', () => {
    // 範囲が極小(誤クリック等)なら全体をそのままアップロード。
    if (!sel || sel.w <= 4 || sel.h <= 4) {
      finish(file);
      return;
    }
    // 表示canvas座標 → 元画像座標へ換算して切り出す。
    const inv = dispScale ? 1 / dispScale : 1;
    const sx = Math.round(sel.x * inv);
    const sy = Math.round(sel.y * inv);
    const sw = Math.round(sel.w * inv);
    const sh = Math.round(sel.h * inv);
    const out = document.createElement('canvas');
    out.width = sw;
    out.height = sh;
    const octx = out.getContext('2d');
    if (!octx) { finish(file); return; }
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    out.toBlob((blob) => {
      if (!blob) { finish(file); return; }
      finish(new File([blob], cropName(), { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.9);
  });
};

// マーカー配置の編集モーダル。新規作成と既存記法の再編集で共用する。
//   - 新規: openMapPreviewModal({ imageUrl, file }) 相当。settings/markers は初期値から。
//   - 編集: initialSettings/initialMarkers/editContext を渡す。確定でブロック置換→保存。
interface PreviewModalOptions {
  imageUrl: string; // 左ペインに表示する平面図画像 URL(登録アセットの imageUrl)
  initialSettings: EditorMapSettings;
  initialMarkers?: EditorMarker[];
  editContext?: EditContext; // あれば「編集(置換保存)」、無ければ「新規(挿入)」
}

const openMapPreviewModal = (opts: PreviewModalOptions): void => {
  const isEdit = !!opts.editContext;
  const name = opts.initialSettings.file;
  const { body } = createModalShell(
    `${isEdit ? '地図を編集' : '地図を作成'}: ${name}`,
    false,
  );
  Object.assign(body.style, { padding: '0' });

  // 初期値をコピーして編集用の作業データにする(呼び出し側の初期値を壊さない)。
  // photos は配列なので、要素ごとコピーして参照共有を避ける(キャンセル時に元を汚さない)。
  const settings: EditorMapSettings = { ...opts.initialSettings };
  const markers: EditorMarker[] = (opts.initialMarkers || []).map((m) => ({
    ...m,
    photos: (m.photos || []).map((p) => ({ ...p })),
  }));
  const imageUrl = opts.imageUrl;
  let selected = -1;

  // 参考写真のアップロード先ページ(現在ページ)を遅延解決してキャッシュする。
  // 編集時は editContext から、新規時は resolveCurrentPageId から取得する。
  let uploadPageInfo: { id: string; path: string } | null = null;
  let uploadPageResolving: Promise<{ id: string; path: string } | null> | null = null;
  const resolveUploadPage = (): Promise<{ id: string; path: string } | null> => {
    if (uploadPageInfo) return Promise.resolve(uploadPageInfo);
    if (uploadPageResolving) return uploadPageResolving;
    uploadPageResolving = (async () => {
      // 編集時: editContext の pageId を使い、パスは現在ページから解決。
      if (opts.editContext) {
        const path = await resolveCurrentPagePath().catch(() => '');
        uploadPageInfo = { id: opts.editContext.pageId, path: path || '' };
        return uploadPageInfo;
      }
      // 新規時: 現在ページの ID とパスを解決。
      const id = await resolveCurrentPageId();
      const path = await resolveCurrentPagePath().catch(() => '');
      if (!id) return null;
      uploadPageInfo = { id, path: path || '' };
      return uploadPageInfo;
    })();
    return uploadPageResolving;
  };

  const layout = document.createElement('div');
  Object.assign(layout.style, { display: 'flex', width: '100%', height: 'min(78vh, 640px)' });

  const left = document.createElement('div');
  Object.assign(left.style, {
    flex: '1 1 auto', position: 'relative', background: '#eee', overflow: 'hidden',
  });
  const viewport = document.createElement('div');
  Object.assign(viewport.style, {
    position: 'absolute', inset: '0', overflow: 'hidden',
    cursor: 'crosshair', touchAction: 'none',
  });
  const stage = document.createElement('div');
  Object.assign(stage.style, {
    position: 'absolute', top: '0', left: '0', transformOrigin: '0 0', willChange: 'transform',
  });
  const img = document.createElement('img');
  img.src = imageUrl;
  img.alt = name;
  Object.assign(img.style, { display: 'block', userSelect: 'none', pointerEvents: 'none' });
  img.draggable = false;
  stage.appendChild(img);
  viewport.appendChild(stage);
  left.appendChild(viewport);

  const hint = document.createElement('div');
  hint.textContent = 'クリックでマーカー追加 / マーカーをドラッグで移動 / ホイール・ピンチで拡大 / 背景ドラッグで移動';
  Object.assign(hint.style, {
    position: 'absolute', left: '8px', bottom: '8px', background: 'rgba(0,0,0,0.6)',
    color: '#fff', fontSize: '11px', padding: '4px 8px', borderRadius: '4px', pointerEvents: 'none',
  });
  left.appendChild(hint);

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    flex: '0 0 300px', borderLeft: '1px solid #e5e5e5', display: 'flex',
    flexDirection: 'column', overflow: 'auto', padding: '12px', gap: '12px',
    boxSizing: 'border-box',
  });

  layout.appendChild(left);
  layout.appendChild(panel);
  body.appendChild(layout);

  const view = { scale: 1, tx: 0, ty: 0 };
  let naturalW = 0;
  let naturalH = 0;
  const markerEls: HTMLElement[] = [];

  // 現在の回転角(deg)から cos/sin を得る。settings.rotate は回転UIで変わる。
  const rotRad = (): number => (settings.rotate * Math.PI) / 180;

  // 元画像座標(px,py)を rotate + scale した後の相対オフセット。
  const rotScale = (px: number, py: number, s: number): { x: number; y: number } => {
    const r = rotRad();
    const cosR = Math.cos(r);
    const sinR = Math.sin(r);
    const sx = px * s;
    const sy = py * s;
    return { x: sx * cosR - sy * sinR, y: sx * sinR + sy * cosR };
  };

  const applyTransform = (): void => {
    stage.style.transform = `translate(${view.tx}px, ${view.ty}px) rotate(${settings.rotate}deg) scale(${view.scale})`;
    const inv = view.scale ? 1 / view.scale : 1;
    for (const el of markerEls) {
      el.style.transform = `translate(-50%, -50%) rotate(${-settings.rotate}deg) scale(${inv})`;
    }
  };

  // viewport 上のクリック点を、回転を打ち消して元画像基準の % に変換する。
  // 画面点 (vx,vy) から中心オフセットを引き、逆回転してからスケールで割る。
  const viewportToPercent = (vx: number, vy: number): { x: number; y: number } => {
    const ox = vx - view.tx;
    const oy = vy - view.ty;
    const r = rotRad();
    const cosR = Math.cos(r);
    const sinR = Math.sin(r);
    // 逆回転(R(-rot)) を掛けてからスケールで割る。
    const ix = (ox * cosR + oy * sinR) / view.scale;
    const iy = (-ox * sinR + oy * cosR) / view.scale;
    return {
      x: clamp((ix / naturalW) * 100, 0, 100),
      y: clamp((iy / naturalH) * 100, 0, 100),
    };
  };

  // viewport にフィットするよう scale と tx/ty を再計算する(回転変更時にも呼ぶ)。
  const fitToViewport = (): void => {
    if (!naturalW || !naturalH) return;
    const vpW = viewport.clientWidth;
    const vpH = viewport.clientHeight;
    const swap = settings.rotate === 90 || settings.rotate === 270;
    const dispW = swap ? naturalH : naturalW;
    const dispH = swap ? naturalW : naturalH;
    const fit = Math.min(vpW / dispW, vpH / dispH);
    view.scale = fit;
    // 元画像中心を viewport 中央に合わせる。
    const off = rotScale(naturalW / 2, naturalH / 2, view.scale);
    view.tx = vpW / 2 - off.x;
    view.ty = vpH / 2 - off.y;
    applyTransform();
  };

  img.addEventListener('load', () => {
    naturalW = img.naturalWidth;
    naturalH = img.naturalHeight;
    stage.style.width = `${naturalW}px`;
    stage.style.height = `${naturalH}px`;
    fitToViewport();
  });

  const renderMarkers = (): void => {
    stage.querySelectorAll('[data-editor-marker]').forEach((el) => el.remove());
    markerEls.length = 0;

    markers.forEach((m, i) => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-editor-marker', String(i));
      Object.assign(wrapper.style, {
        position: 'absolute', left: `${m.x}%`, top: `${m.y}%`, zIndex: '5',
      });
      const inner = document.createElement('div');
      Object.assign(inner.style, {
        position: 'relative', transformOrigin: 'center center',
        transform: 'translate(-50%, -50%)',
      });
      // プレビューも実際の表示サイズ(settings.pinSize/labelSize)で描く。
      const pinPx = settings.pinSize || PIN_SIZE_DEFAULT;
      const labelPx = settings.labelSize || LABEL_SIZE_DEFAULT;
      const pin = document.createElement('div');
      const isSel = i === selected;
      Object.assign(pin.style, {
        width: `${pinPx}px`, height: `${pinPx}px`, backgroundColor: m.color || DEFAULT_MARKER_COLOR,
        border: isSel ? '3px solid #fff' : '2px solid #fff', borderRadius: '50%',
        boxShadow: isSel ? '0 0 0 2px #0d6efd, 0 1px 4px rgba(0,0,0,0.5)' : '0 1px 3px rgba(0,0,0,0.5)',
        cursor: 'pointer',
      });
      if (m.label) {
        const label = document.createElement('div');
        label.textContent = m.label;
        Object.assign(label.style, {
          position: 'absolute', bottom: `${pinPx + 4}px`, left: '50%', transform: 'translateX(-50%)',
          backgroundColor: m.color || DEFAULT_MARKER_COLOR,
          color: textColorForBg(m.color || DEFAULT_MARKER_COLOR), padding: '2px 6px',
          borderRadius: '4px', fontSize: `${labelPx}px`, whiteSpace: 'nowrap', pointerEvents: 'none',
        });
        inner.appendChild(label);
      }
      inner.appendChild(pin);
      wrapper.appendChild(inner);
      attachMarkerDrag(wrapper, i);
      stage.appendChild(wrapper);
      markerEls.push(inner);
    });
    applyTransform();
  };

  // マーカーのドラッグ移動。pointerdown からしきい値を超えて動いたらドラッグ扱いにし、
  // viewportToPercent で画面座標→元画像基準の % に変換して x/y を更新する。動かず
  // pointerup したら従来どおり選択のみ(クリック扱い)。viewport のパン/新規追加と
  // 競合しないよう、マーカー上の pointer イベントは stopPropagation して viewport に流さない。
  function attachMarkerDrag(wrapper: HTMLElement, index: number): void {
    let dragging = false;
    let movedMarker = false;
    let startClientX = 0;
    let startClientY = 0;

    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      if (!movedMarker
        && Math.abs(e.clientX - startClientX) <= MOVE_THRESHOLD
        && Math.abs(e.clientY - startClientY) <= MOVE_THRESHOLD) {
        return; // しきい値未満は単純クリック候補としてまだ動かさない
      }
      movedMarker = true;
      const p = vpPoint(e.clientX, e.clientY);
      const pos = viewportToPercent(p.x, p.y);
      const m = markers[index];
      if (!m) return;
      m.x = round1(pos.x);
      m.y = round1(pos.y);
      // 位置だけ即時反映(再生成せず該当要素を動かす)。
      wrapper.style.left = `${m.x}%`;
      wrapper.style.top = `${m.y}%`;
      // 選択中マーカーなら X/Y 入力欄にも反映する。
      if (selected === index) updateSelectedXYInputs(m.x, m.y);
    };

    const onUp = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      try { wrapper.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      wrapper.removeEventListener('pointermove', onMove);
      wrapper.removeEventListener('pointerup', onUp);
      wrapper.removeEventListener('pointercancel', onUp);
      if (movedMarker) {
        // ドラッグ確定。選択枠(renderMarkers)とパネルの一覧・選択表示を最新化する。
        selected = index;
        renderMarkers();
        renderPanel();
      } else {
        // 動いていなければ従来のクリック=選択。
        selectMarker(index);
      }
    };

    wrapper.addEventListener('pointerdown', (e: PointerEvent) => {
      e.stopPropagation(); // viewport のパン/新規追加へ伝播させない
      dragging = true;
      movedMarker = false;
      startClientX = e.clientX;
      startClientY = e.clientY;
      try { wrapper.setPointerCapture(e.pointerId); } catch { /* noop */ }
      wrapper.addEventListener('pointermove', onMove);
      wrapper.addEventListener('pointerup', onUp);
      wrapper.addEventListener('pointercancel', onUp);
    });
  }

  const renderPanel = (focusLabel = false): void => {
    panel.innerHTML = '';

    const back = document.createElement('button');
    back.type = 'button';
    // 新規: アセット一覧に戻る。編集: 破棄して閉じる(一覧に戻る動線はないため)。
    back.textContent = isEdit ? '← 編集を破棄して閉じる' : '← 地図一覧に戻る';
    Object.assign(back.style, {
      background: '#f0f0f0', border: '1px solid #ccc', borderRadius: '4px',
      padding: '6px 10px', cursor: 'pointer', fontSize: '12px', alignSelf: 'flex-start',
    });
    back.addEventListener('click', () => {
      if (isEdit) {
        const overlay = document.getElementById(MODAL_ID);
        if (overlay) overlay.remove();
      } else {
        openImageListModal();
      }
    });
    panel.appendChild(back);

    panel.appendChild(sectionTitle('地図全体の設定'));
    panel.appendChild(fieldText('起動ボタンの文言 (link)', settings.link, (v) => { settings.link = v; }));
    panel.appendChild(fieldNumber('自動復帰(秒) (restore)', settings.restore, (v) => { settings.restore = v; }));
    panel.appendChild(fieldNumber('初期中心X% (cx)', settings.cx, (v) => { settings.cx = v; }));
    panel.appendChild(fieldNumber('初期中心Y% (cy)', settings.cy, (v) => { settings.cy = v; }));
    panel.appendChild(fieldNumber('初期倍率 (scale)', settings.scale, (v) => { settings.scale = v; }));
    panel.appendChild(fieldRotate('回転 (rotate)', settings.rotate, (v) => {
      settings.rotate = normalizeRotate(v);
      fitToViewport();
      renderMarkers();
      renderPanel();
    }));

    // ピン・ラベルのサイズ(px)。マップ全体共通。範囲でクランプして画面崩れを防ぐ。
    const pinField = fieldNumber(
      `ピンサイズ px (${PIN_SIZE_MIN}〜${PIN_SIZE_MAX})`,
      settings.pinSize,
      (v) => { settings.pinSize = clamp(v, PIN_SIZE_MIN, PIN_SIZE_MAX); renderMarkers(); },
    );
    panel.appendChild(pinField);
    const labelField = fieldNumber(
      `ラベル文字サイズ px (${LABEL_SIZE_MIN}〜${LABEL_SIZE_MAX})`,
      settings.labelSize,
      (v) => { settings.labelSize = clamp(v, LABEL_SIZE_MIN, LABEL_SIZE_MAX); renderMarkers(); },
    );
    panel.appendChild(labelField);
    // 既定値に戻すボタン。
    const resetSize = document.createElement('button');
    resetSize.type = 'button';
    resetSize.textContent = 'ピン・ラベルサイズを既定値に戻す';
    Object.assign(resetSize.style, {
      background: '#f0f0f0', border: '1px solid #ccc', borderRadius: '4px',
      padding: '5px 10px', cursor: 'pointer', fontSize: '12px', alignSelf: 'flex-start',
    });
    resetSize.addEventListener('click', () => {
      settings.pinSize = PIN_SIZE_DEFAULT;
      settings.labelSize = LABEL_SIZE_DEFAULT;
      renderMarkers();
      renderPanel();
    });
    panel.appendChild(resetSize);

    panel.appendChild(sectionTitle(`マーカー一覧 (${markers.length})`));
    if (markers.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = '平面図をクリックしてマーカーを追加';
      Object.assign(empty.style, { color: '#888', fontSize: '12px' });
      panel.appendChild(empty);
    } else {
      markers.forEach((m, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.textContent = `#${i + 1} ${m.label || '(ラベルなし)'}`;
        Object.assign(row.style, {
          display: 'block', width: '100%', textAlign: 'left', fontSize: '12px',
          padding: '6px 8px', marginBottom: '4px', cursor: 'pointer',
          border: '1px solid ' + (i === selected ? '#0d6efd' : '#ddd'),
          background: i === selected ? '#e7f1ff' : '#fff', borderRadius: '4px',
        });
        row.addEventListener('click', () => selectMarker(i));
        panel.appendChild(row);
      });
    }

    if (selected >= 0 && selected < markers.length) {
      const m = markers[selected];
      panel.appendChild(sectionTitle(`選択中: #${selected + 1}`));
      const xField = fieldNumber('X (%)', m.x, (v) => { m.x = clamp(v, 0, 100); renderMarkers(); });
      const yField = fieldNumber('Y (%)', m.y, (v) => { m.y = clamp(v, 0, 100); renderMarkers(); });
      // ドラッグ移動中に値を書き戻せるよう、入力要素に目印を付ける。
      xField.querySelector('input')?.setAttribute('data-marker-x', '1');
      yField.querySelector('input')?.setAttribute('data-marker-y', '1');
      panel.appendChild(xField);
      panel.appendChild(yField);
      const labelField = fieldText('ラベル (label)', m.label, (v) => { m.label = v; renderMarkers(); });
      panel.appendChild(labelField);
      if (focusLabel) {
        const labelInput = labelField.querySelector('input');
        if (labelInput) {
          window.setTimeout(() => { labelInput.focus(); labelInput.select(); }, 0);
        }
      }
      panel.appendChild(photoListField(m));
      panel.appendChild(fieldColor('色 (color)', m.color, (v) => { m.color = v; renderMarkers(); }));
      panel.appendChild(fieldText('説明/注意 (desc, | で改行)', m.desc, (v) => { m.desc = v; }));

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'このマーカーを削除';
      Object.assign(del.style, {
        background: '#dc3545', color: '#fff', border: 'none', borderRadius: '4px',
        padding: '8px', cursor: 'pointer', fontSize: '13px', marginTop: '6px',
      });
      del.addEventListener('click', () => {
        markers.splice(selected, 1);
        selected = -1;
        renderMarkers();
        renderPanel();
      });
      panel.appendChild(del);
    }

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = isEdit ? '変更を保存' : '確定して挿入';
    Object.assign(confirm.style, {
      marginTop: 'auto', background: '#0d6efd', color: '#fff', border: 'none',
      borderRadius: '4px', padding: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold',
    });
    confirm.addEventListener('click', () => {
      // 生成する記法。編集時は前後の余計な空行を付けない(ブロックだけ差し替えるため)。
      const snippet = buildCustomMapSnippet(settings, markers).replace(/^\n+|\n+$/g, '');

      if (isEdit && opts.editContext) {
        // 既存ブロックを置換してページ本文を保存する。
        const ctx = opts.editContext;
        const newBody = ctx.fullBody.slice(0, ctx.block.start)
          + snippet
          + ctx.fullBody.slice(ctx.block.end);
        confirm.disabled = true;
        confirm.textContent = '保存中...';
        updatePageBody(ctx.pageId, ctx.revisionId, newBody)
          .then(() => {
            showToast('地図を保存しました。ページを再読み込みします。');
            // 保存済み本文とエディタの表示を一致させるためリロードする。
            window.setTimeout(() => window.location.reload(), 800);
          })
          .catch((err) => {
            console.error('[custom-map-editor] save failed', err);
            showToast(`保存に失敗しました: ${err.message}`, true);
            confirm.disabled = false;
            confirm.textContent = '変更を保存';
          });
        return;
      }

      // 新規: カーソル位置に挿入。
      const overlay = document.getElementById(MODAL_ID);
      if (overlay) overlay.remove();
      const ok = insertTextAtCursor(buildCustomMapSnippet(settings, markers));
      if (ok) {
        showToast('地図の記法をカーソル位置に挿入しました。');
      } else {
        copyToClipboard(buildCustomMapSnippet(settings, markers));
      }
    });
    panel.appendChild(confirm);
  };

  const selectMarker = (i: number): void => {
    selected = i;
    renderMarkers();
    renderPanel(true);
  };

  // ドラッグ移動中に、選択中マーカーの X/Y 数値入力欄へ現在値を反映する。
  // パネル全体を再描画しないので入力中のフォーカスを奪わない。
  const updateSelectedXYInputs = (x: number, y: number): void => {
    const xInput = panel.querySelector<HTMLInputElement>('input[data-marker-x]');
    const yInput = panel.querySelector<HTMLInputElement>('input[data-marker-y]');
    if (xInput) xInput.value = String(x);
    if (yInput) yInput.value = String(y);
  };

  function sectionTitle(text: string): HTMLElement {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, {
      fontWeight: 'bold', fontSize: '13px', marginTop: '6px',
      borderBottom: '1px solid #eee', paddingBottom: '4px',
    });
    return el;
  }
  function fieldWrap(labelText: string, input: HTMLElement): HTMLElement {
    const wrap = document.createElement('label');
    Object.assign(wrap.style, { display: 'block', fontSize: '12px', color: '#333' });
    const lab = document.createElement('div');
    lab.textContent = labelText;
    Object.assign(lab.style, { marginBottom: '2px' });
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }
  function fieldText(labelText: string, value: string, onChange: (v: string) => void): HTMLElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    Object.assign(input.style, { width: '100%', padding: '4px 6px', boxSizing: 'border-box', fontSize: '12px' });
    input.addEventListener('input', () => onChange(input.value));
    return fieldWrap(labelText, input);
  }
  function fieldNumber(labelText: string, value: number, onChange: (v: number) => void): HTMLElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = String(value);
    input.step = 'any';
    Object.assign(input.style, { width: '100%', padding: '4px 6px', boxSizing: 'border-box', fontSize: '12px' });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) onChange(v);
    });
    return fieldWrap(labelText, input);
  }
  function fieldRotate(labelText: string, value: number, onChange: (v: number) => void): HTMLElement {
    const container = document.createElement('div');
    const grid = document.createElement('div');
    Object.assign(grid.style, { display: 'flex', gap: '6px' });
    const options = [0, 90, 180, 270];
    const btns: { deg: number; el: HTMLButtonElement }[] = [];
    const refresh = (cur: number): void => {
      for (const b of btns) {
        const isSel = b.deg === cur;
        Object.assign(b.el.style, {
          background: isSel ? '#0d6efd' : '#fff',
          color: isSel ? '#fff' : '#333',
          borderColor: isSel ? '#0d6efd' : '#ccc',
        });
      }
    };
    for (const deg of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${deg}°`;
      Object.assign(btn.style, {
        flex: '1 1 0', padding: '5px 0', fontSize: '12px', cursor: 'pointer',
        border: '1px solid #ccc', borderRadius: '4px', background: '#fff',
      });
      btn.addEventListener('click', () => { refresh(deg); onChange(deg); });
      grid.appendChild(btn);
      btns.push({ deg, el: btn });
    }
    refresh(normalizeRotate(value));
    container.appendChild(grid);
    return fieldWrap(labelText, container);
  }
  function fieldColor(labelText: string, value: string, onChange: (v: string) => void): HTMLElement {
    const container = document.createElement('div');
    const grid = document.createElement('div');
    Object.assign(grid.style, {
      display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '6px',
    });
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.value = value || DEFAULT_MARKER_COLOR;
    Object.assign(codeInput.style, {
      width: '100%', padding: '4px 6px', boxSizing: 'border-box',
      fontSize: '12px', fontFamily: 'monospace',
    });
    const swatchEls: { color: string; el: HTMLElement }[] = [];
    const refreshSelection = (current: string): void => {
      const cur = (current || '').toLowerCase();
      for (const s of swatchEls) {
        const isSel = s.color.toLowerCase() === cur;
        s.el.style.border = isSel ? '2px solid #0d6efd' : '2px solid transparent';
        s.el.style.padding = '2px';
      }
    };
    const setColor = (c: string): void => {
      codeInput.value = c;
      refreshSelection(c);
      onChange(c);
    };
    for (const c of PRESET_COLORS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = c;
      Object.assign(btn.style, {
        boxSizing: 'border-box', border: '2px solid transparent', padding: '2px',
        borderRadius: '5px', background: 'transparent', cursor: 'pointer', lineHeight: '0',
      });
      const block = document.createElement('span');
      Object.assign(block.style, {
        display: 'block', width: '20px', height: '20px', borderRadius: '3px',
        background: c, border: '1px solid #999',
      });
      btn.appendChild(block);
      btn.addEventListener('click', () => setColor(c));
      grid.appendChild(btn);
      swatchEls.push({ color: c, el: btn });
    }
    codeInput.addEventListener('input', () => {
      refreshSelection(codeInput.value);
      onChange(codeInput.value);
    });
    refreshSelection(codeInput.value);
    container.appendChild(grid);
    container.appendChild(codeInput);
    return fieldWrap(labelText, container);
  }

  // 参考写真リストの編集フィールド。1 マーカーの photos 配列を追加/削除/並び替えし、
  // 各写真のファイル名とコメントを入力する。段階 A ではファイル名指定のみ
  // (アップロード UI は段階 B)。container の中身を rebuild で作り直す。
  function photoListField(m: EditorMarker): HTMLElement {
    const container = document.createElement('div');

    const title = document.createElement('div');
    title.textContent = '参考写真 (複数可)';
    Object.assign(title.style, {
      fontWeight: 'bold', fontSize: '13px', marginTop: '6px',
      borderBottom: '1px solid #eee', paddingBottom: '4px', marginBottom: '6px',
    });
    container.appendChild(title);

    const list = document.createElement('div');
    Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '8px' });
    container.appendChild(list);

    const rebuild = (): void => {
      list.innerHTML = '';
      if (m.photos.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = '写真はありません。「＋ 写真を追加」で追加できます。';
        Object.assign(empty.style, { color: '#888', fontSize: '12px' });
        list.appendChild(empty);
      }
      m.photos.forEach((p, pi) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          border: '1px solid #e0e0e0', borderRadius: '5px', padding: '8px',
          background: '#fafafa', display: 'flex', flexDirection: 'column', gap: '6px',
        });

        // ヘッダ行(番号 + 上下移動 + 削除)。
        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '4px' });
        const no = document.createElement('div');
        no.textContent = `写真 #${pi + 1}`;
        Object.assign(no.style, { fontSize: '12px', fontWeight: 'bold', flex: '1 1 auto' });
        head.appendChild(no);

        const mkIconBtn = (text: string, title2: string, disabled: boolean): HTMLButtonElement => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = text;
          b.title = title2;
          b.disabled = disabled;
          Object.assign(b.style, {
            border: '1px solid #ccc', borderRadius: '4px', background: '#fff',
            cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '12px',
            padding: '2px 7px', color: disabled ? '#bbb' : '#333',
          });
          return b;
        };
        const upBtn = mkIconBtn('↑', '上へ', pi === 0);
        upBtn.addEventListener('click', () => {
          if (pi === 0) return;
          [m.photos[pi - 1], m.photos[pi]] = [m.photos[pi], m.photos[pi - 1]];
          rebuild();
        });
        const downBtn = mkIconBtn('↓', '下へ', pi === m.photos.length - 1);
        downBtn.addEventListener('click', () => {
          if (pi === m.photos.length - 1) return;
          [m.photos[pi + 1], m.photos[pi]] = [m.photos[pi], m.photos[pi + 1]];
          rebuild();
        });
        const delBtn = mkIconBtn('✕', 'この写真を削除', false);
        Object.assign(delBtn.style, { color: '#dc3545', borderColor: '#e2a9ad' });
        delBtn.addEventListener('click', () => {
          m.photos.splice(pi, 1);
          rebuild();
        });
        head.appendChild(upBtn);
        head.appendChild(downBtn);
        head.appendChild(delBtn);
        row.appendChild(head);

        // ファイル名入力。
        const fileInput = document.createElement('input');
        fileInput.type = 'text';
        fileInput.value = p.photo;
        fileInput.placeholder = '添付ファイル名 (例: photo1.jpg)';
        Object.assign(fileInput.style, {
          width: '100%', padding: '4px 6px', boxSizing: 'border-box', fontSize: '12px',
        });
        fileInput.addEventListener('input', () => { p.photo = fileInput.value; });
        row.appendChild(fileInput);

        // アップロード(このページの添付として)。選択→POST→originalName を反映。
        const upRow = document.createElement('div');
        Object.assign(upRow.style, { display: 'flex', alignItems: 'center', gap: '6px' });
        const upLabel = document.createElement('label');
        upLabel.textContent = '⬆ 画像をアップロード';
        Object.assign(upLabel.style, {
          display: 'inline-block', background: '#eef3ff', border: '1px solid #b9ccf5',
          color: '#0d47a1', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer',
          fontSize: '12px', whiteSpace: 'nowrap',
        });
        const upInput = document.createElement('input');
        upInput.type = 'file';
        upInput.accept = 'image/*';
        upInput.style.display = 'none';
        const upStatus = document.createElement('span');
        Object.assign(upStatus.style, { fontSize: '11px', color: '#666' });
        upLabel.appendChild(upInput);
        upRow.appendChild(upLabel);
        upRow.appendChild(upStatus);
        row.appendChild(upRow);

        // 切り抜き結果(またはそのまま)をアップロードして記法へ反映する。
        const doUpload = async (fileToUpload: File): Promise<void> => {
          upStatus.textContent = 'アップロード先ページを確認中...';
          upLabel.style.pointerEvents = 'none';
          upLabel.style.opacity = '0.6';
          try {
            const page = await resolveUploadPage();
            if (!page) {
              upStatus.textContent = 'ページを特定できませんでした';
              return;
            }
            upStatus.textContent = 'アップロード中...';
            const uploaded = await uploadAttachment(page.id, fileToUpload, page.path);
            p.photo = uploaded.originalName;
            fileInput.value = uploaded.originalName;
            upStatus.textContent = `✓ ${uploaded.originalName}`;
            upStatus.style.color = '#207544';
          } catch (err) {
            console.error('[custom-map-editor] upload failed', err);
            upStatus.textContent = `失敗: ${(err as Error).message}`;
            upStatus.style.color = '#b00020';
          } finally {
            upLabel.style.pointerEvents = '';
            upLabel.style.opacity = '';
          }
        };

        upInput.addEventListener('change', () => {
          const f = upInput.files && upInput.files[0];
          upInput.value = ''; // 同じファイルを続けて選べるようリセット
          if (!f) return;
          // アップロード前に切り抜きモーダルを開く。範囲未選択なら全体、
          // 選べばその矩形を JPEG で切り出してアップロードする。
          openCropModal(f, (result) => { doUpload(result).catch(() => { /* 表示済み */ }); });
        });

        // コメント入力。
        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.value = p.desc;
        descInput.placeholder = 'この写真のコメント (任意, | で改行)';
        Object.assign(descInput.style, {
          width: '100%', padding: '4px 6px', boxSizing: 'border-box', fontSize: '12px',
        });
        descInput.addEventListener('input', () => { p.desc = descInput.value; });
        row.appendChild(descInput);

        list.appendChild(row);
      });
    };

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '＋ 写真を追加';
    Object.assign(addBtn.style, {
      marginTop: '8px', background: '#f0f0f0', border: '1px solid #ccc',
      borderRadius: '4px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px',
    });
    addBtn.addEventListener('click', () => {
      m.photos.push({ photo: '', desc: '' });
      rebuild();
    });

    rebuild();
    container.appendChild(addBtn);
    return container;
  }

  // ---- ズーム/パン + クリックでマーカー配置 ----
  const pointers = new Map<number, { x: number; y: number }>();
  let panStartTx = 0; let panStartTy = 0; let panStartX = 0; let panStartY = 0;
  let pinchStartDist = 0; let pinchStartScale = 1; let pinchStartTx = 0; let pinchStartTy = 0;
  let pinchCenter = { x: 0, y: 0 };
  let downPos = { x: 0, y: 0 };
  let moved = false;
  const MOVE_THRESHOLD = 5;

  const vpPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = viewport.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  viewport.addEventListener('pointerdown', (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { viewport.setPointerCapture(e.pointerId); } catch { /* noop */ }
    if (pointers.size === 1) {
      panStartX = e.clientX; panStartY = e.clientY;
      panStartTx = view.tx; panStartTy = view.ty;
      downPos = { x: e.clientX, y: e.clientY };
      moved = false;
    } else if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      pinchStartScale = view.scale; pinchStartTx = view.tx; pinchStartTy = view.ty;
      pinchCenter = vpPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      moved = true;
    }
  });

  viewport.addEventListener('pointermove', (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const [a, b] = Array.from(pointers.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const newScale = clamp(pinchStartScale * (dist / pinchStartDist), 0.05, 40);
      const ratio = newScale / pinchStartScale;
      view.tx = pinchCenter.x - (pinchCenter.x - pinchStartTx) * ratio;
      view.ty = pinchCenter.y - (pinchCenter.y - pinchStartTy) * ratio;
      view.scale = newScale;
      applyTransform();
    } else if (pointers.size === 1) {
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (Math.abs(e.clientX - downPos.x) > MOVE_THRESHOLD || Math.abs(e.clientY - downPos.y) > MOVE_THRESHOLD) {
        moved = true;
      }
      view.tx = panStartTx + dx;
      view.ty = panStartTy + dy;
      applyTransform();
    }
  });

  const endPointer = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return;
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    try { viewport.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (wasSingle && !moved) {
      const p = vpPoint(e.clientX, e.clientY);
      const pos = viewportToPercent(p.x, p.y);
      markers.push({
        x: round1(pos.x), y: round1(pos.y), label: '',
        color: DEFAULT_MARKER_COLOR, desc: '', photos: [],
      });
      selected = markers.length - 1;
      renderMarkers();
      renderPanel(true);
    }
    if (pointers.size === 1) {
      const [p] = Array.from(pointers.values());
      panStartX = p.x; panStartY = p.y; panStartTx = view.tx; panStartTy = view.ty;
    }
  };
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);

  viewport.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const p = vpPoint(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = clamp(view.scale * factor, 0.05, 40);
    const ratio = newScale / view.scale;
    view.tx = p.x - (p.x - view.tx) * ratio;
    view.ty = p.y - (p.y - view.ty) * ratio;
    view.scale = newScale;
    applyTransform();
  }, { passive: false });

  renderPanel();
  renderMarkers();
};

// ------------------------------------------------------------
// フローティングボタン
// ------------------------------------------------------------
// ストックページ(figure登録用ページ)では地図作成 FAB を出さない。
// そこは「図面の向き設定」の作業ページで、地図記法を書く場所ではないため。
// パス解決は非同期(ID ベース URL 環境では API 解決が必要)なのでキャッシュする。
const normPath = (p: string): string => p.replace(/\/+$/, '') || '/';
let onStockCache: { forUrl: string; value: boolean } | null = null;
let stockResolving = false;

const refreshStockJudgement = (onUpdate: () => void): void => {
  if (typeof location === 'undefined') return;
  const url = location.pathname;
  if (onStockCache && onStockCache.forUrl === url) return;
  if (stockResolving) return;
  stockResolving = true;
  resolveCurrentPagePath()
    .then((path) => {
      const value = !!path && normPath(path) === normPath(getDefaultStockPage());
      onStockCache = { forUrl: url, value };
      onUpdate();
    })
    .catch(() => { onStockCache = { forUrl: url, value: false }; })
    .finally(() => { stockResolving = false; });
};

const isOnStockPageCached = (): boolean => {
  if (typeof location === 'undefined') return false;
  if (onStockCache && onStockCache.forUrl === location.pathname) return onStockCache.value;
  return false;
};

const ensureFab = (): void => {
  const editing = isEditing();
  const existing = document.getElementById(BTN_ID);
  const existingEdit = document.getElementById(EDIT_BTN_ID);

  const removeAll = (): void => {
    if (existing) existing.remove();
    if (existingEdit) existingEdit.remove();
  };

  if (!editing) {
    removeAll();
    return;
  }

  // ストックページなら地図作成ボタンを出さない(向き設定ボタンと役割分離)。
  refreshStockJudgement(() => ensureFab());
  if (isOnStockPageCached()) {
    removeAll();
    return;
  }

  if (existing && existingEdit) return;
  removeAll();

  // 「地図を作成」FAB(新規)。
  const fab = document.createElement('button');
  fab.id = BTN_ID;
  fab.type = 'button';
  fab.textContent = '🛠️ 地図を作成';
  Object.assign(fab.style, {
    position: 'fixed', right: '24px', bottom: '56px', zIndex: '99999',
    background: '#0d6efd', color: '#fff', border: 'none', borderRadius: '24px',
    padding: '12px 18px', fontSize: '14px', fontWeight: 'bold',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)', cursor: 'pointer',
  });
  fab.addEventListener('click', (e) => {
    e.preventDefault();
    saveEditorSelection();
    // 安全ガード: カーソルが既存 custom-map ブロック内なら新規挿入しない。
    // 記法の中に記法を挿入すると構成が壊れるため、編集を促す。
    if (isCursorInsideCustomMap()) {
      showToast('地図の記法の中にカーソルがあります。既存の地図を直すには「地図を編集」を使ってください。', true);
      return;
    }
    openImageListModal().catch((err) => console.error('[custom-map-editor] failed to open modal', err));
  });
  document.body.appendChild(fab);

  // 「地図を編集」FAB。作成ボタンの上に配置する。
  const editFab = document.createElement('button');
  editFab.id = EDIT_BTN_ID;
  editFab.type = 'button';
  editFab.textContent = '🖊️ 地図を編集';
  Object.assign(editFab.style, {
    position: 'fixed', right: '24px', bottom: '104px', zIndex: '99999',
    background: '#f0ad00', color: '#1f1300', border: 'none', borderRadius: '24px',
    padding: '12px 18px', fontSize: '14px', fontWeight: 'bold',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)', cursor: 'pointer',
  });
  editFab.addEventListener('click', (e) => {
    e.preventDefault();
    openEditListModal().catch((err) => console.error('[custom-map-editor] failed to open edit modal', err));
  });
  document.body.appendChild(editFab);
};

// ------------------------------------------------------------
// activate / deactivate
// ------------------------------------------------------------
let observer: MutationObserver | undefined;
let intervalId: number | undefined;
let onHashChange: (() => void) | undefined;

export const activateEditor = (): void => {
  onHashChange = () => ensureFab();
  window.addEventListener('hashchange', onHashChange);
  try {
    observer = new MutationObserver(() => ensureFab());
    observer.observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.warn('[custom-map-editor] MutationObserver 未対応', e);
  }
  intervalId = window.setInterval(ensureFab, 1000);
  ensureFab();
  console.log('[custom-map-editor] activated');
};

export const deactivateEditor = (): void => {
  if (onHashChange) { window.removeEventListener('hashchange', onHashChange); onHashChange = undefined; }
  if (observer) { observer.disconnect(); observer = undefined; }
  if (intervalId) { window.clearInterval(intervalId); intervalId = undefined; }
  const existing = document.getElementById(BTN_ID);
  if (existing) existing.remove();
  const existingEdit = document.getElementById(EDIT_BTN_ID);
  if (existingEdit) existingEdit.remove();
};

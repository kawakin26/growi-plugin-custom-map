// ============================================================
// 共通ユーティリティ(表示 viewer と 編集 editor で共有)
// ============================================================

// 規定のストック用ページ。window.GROWI_CUSTOM_MAP_CONFIG.defaultSrc で上書き可能。
const DEFAULT_STOCK_PAGE = '/media-library';

// ページパスの末尾スラッシュを除去して比較・API呼び出しに使う。
export const normalizePagePath = (path: string): string => {
  const value = String(path || '').trim();
  if (value === '/' || value === '') return value;
  return value.replace(/\/+$/, '');
};

export const getDefaultStockPage = (): string => {
  const cfg = (window as unknown as { GROWI_CUSTOM_MAP_CONFIG?: { defaultSrc?: string } })
    .GROWI_CUSTOM_MAP_CONFIG;
  const v = cfg && typeof cfg.defaultSrc === 'string' ? cfg.defaultSrc.trim() : '';
  return v || DEFAULT_STOCK_PAGE;
};

// ストックページ自身、またはその配下のページかどうかを判定する。
export const isStockAreaPath = (path: string, stockPath = getDefaultStockPage()): boolean => {
  const pathValue = normalizePagePath(path);
  const stockValue = normalizePagePath(stockPath);
  if (!pathValue || !stockValue) return false;
  return pathValue === stockValue || pathValue.startsWith(`${stockValue}/`);
};

// CAD 変換 API のエンドポイント。window.GROWI_CUSTOM_MAP_CONFIG.cadConvertApi で設定。
// 未設定なら CAD 変換機能はオフ。
export const getCadConvertApi = (): string => {
  const cfg = (window as unknown as { GROWI_CUSTOM_MAP_CONFIG?: { cadConvertApi?: string } })
    .GROWI_CUSTOM_MAP_CONFIG;
  const v = cfg && typeof cfg.cadConvertApi === 'string' ? cfg.cadConvertApi.trim() : '';
  return v;
};

// ============================================================
// アセット登録 API(方式Q)クライアント。
// cadConvertApi は変換エンドポイント(/convert)を指すので、その末尾を /assets に
// 置き換えてアセット管理エンドポイントの URL を組み立てる。
// ============================================================

// 変換 API のベースから /assets エンドポイントの URL を導出する。
// 例: https://gw/cad/convert -> https://gw/cad/assets
const getAssetsApiBase = (): string => {
  const api = getCadConvertApi();
  if (!api) return '';
  // 末尾の /convert(クエリ以降は無視)を /assets に置換。
  const [path] = api.split('?');
  if (/\/convert$/.test(path)) return path.replace(/\/convert$/, '/assets');
  // /convert で終わっていない場合は、末尾に /assets を足す(フォールバック)。
  return `${path.replace(/\/$/, '')}/assets`;
};

// 登録アセット1件
export interface RegisteredAsset {
  name: string;
  key?: string;
  file?: string;
  ext?: string;
  type: string;
  srcFile: string;
  src: string;
  rotate: number;
  createdAt: string;
  imageUrl: string;
}

// 登録候補ファイル(登録状態・種別付き)1件
export interface SourceFileEntry {
  name: string;
  // deep 検索時は、実際に添付が存在するページのパス。
  src?: string;
  type: 'cad' | 'image';
  registered: boolean;
  registeredAs: string[];
}

// ページ内の登録候補(CAD＋画像)一覧を登録状態付きで取得する(登録タブ用)。
// 登録済みの元ファイルも除外せず返る(別名で再登録できる運用)。
// deep=true を指定すると、src 配下の全子孫ページの添付も含めて返す(階層横断)。
export const fetchSourceFiles = async (src: string, deep = false): Promise<SourceFileEntry[]> => {
  const base = getAssetsApiBase();
  if (!base) throw new Error('cadConvertApi is not configured');
  const deepParam = deep ? '&deep=true' : '';
  const url = `${base}/source-files?src=${encodeURIComponent(src)}${deepParam}`;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`fetch source files failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.files) ? (data.files as SourceFileEntry[]) : [];
};

// 登録済みアセット一覧を取得する(削除タブ用)。src 省略で全件。
// deep=true を指定すると、src 配下の全子孫ページ由来のアセットも含めて返す。
export const fetchRegisteredAssets = async (src?: string, deep = false): Promise<RegisteredAsset[]> => {
  const base = getAssetsApiBase();
  if (!base) throw new Error('cadConvertApi is not configured');
  const deepParam = deep ? '&deep=true' : '';
  const url = src ? `${base}?src=${encodeURIComponent(src)}${deepParam}` : base;
  const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`fetch assets failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.assets) ? (data.assets as RegisteredAsset[]) : [];
};

// CAD または画像を別名で登録する。成功時は登録結果(imageUrl 等)を返す。
// 種別は API 側が file の拡張子で判定する(rotate は CAD のみ有効)。
export const registerAsset = async (params: {
  name: string; file: string; src: string; rotate: number;
}): Promise<{ imageUrl: string; name: string; rotate: number; type: string }> => {
  const base = getAssetsApiBase();
  if (!base) throw new Error('cadConvertApi is not configured');
  const res = await fetch(base, {
    method: 'POST',
    // GROWI のログイン Cookie を付けて送る(WRITE_AUTH_MODE='group'/'authenticated' の判定に使う)。
    // 'include' にするとクロスオリジン配置(別ホスト)でも Cookie を送れる(API 側の
    // CORS_ORIGINS で具体的な origin を許可していれば動作する)。
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data as Record<string, unknown>).message) || `register failed: ${res.status}`;
    throw new Error(String(msg));
  }
  return data as { imageUrl: string; name: string; rotate: number; type: string };
};

// 登録アセットを削除する。
// 注意: 現在の向き設定 UI からは呼び出さない(削除は過去ページを壊す恐れがあり、
// 安全な使用箇所確認が難しいため UI から廃止)。将来のサーバー CLI ツール等の
// ために関数は残置する。
export const deleteCadAsset = async (name: string): Promise<void> => {
  const base = getAssetsApiBase();
  if (!base) throw new Error('cadConvertApi is not configured');
  const url = `${base}?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    credentials: 'include', // GROWI のログイン Cookie を付けて送る(registerAsset と同様)。
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = (data && (data as Record<string, unknown>).message) || `delete failed: ${res.status}`;
    throw new Error(String(msg));
  }
};

// 登録アセットの解決結果キャッシュ(ページパス単位で登録一覧を1回取得)。
const registeredAssetsCache = new Map<string, Promise<RegisteredAsset[]>>();

// 指定ページの登録アセット一覧を取得(キャッシュ付き)。API 未設定や失敗時は空配列。
const getRegisteredAssetsCached = (src: string): Promise<RegisteredAsset[]> => {
  const key = src || '';
  const cached = registeredAssetsCache.get(key);
  if (cached) return cached;
  const promise = (async (): Promise<RegisteredAsset[]> => {
    const base = getAssetsApiBase();
    if (!base) return [];
    try {
      const url = key ? `${base}?src=${encodeURIComponent(key)}` : base;
      const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.assets) ? (data.assets as RegisteredAsset[]) : [];
    } catch {
      return [];
    }
  })();
  registeredAssetsCache.set(key, promise);
  return promise;
};

// file 名が登録アセットなら、その配信 URL を返す。未登録・API 未設定なら null。
// src 指定ページの登録に加え、規定ストックページの登録も探索する。
export const resolveRegisteredAssetUrl = async (
  fileName: string,
  candidateSrcs: string[],
): Promise<string | null> => {
  if (!fileName) return null;
  const base = getAssetsApiBase();
  if (!base) return null;
  const srcs = Array.from(new Set([...candidateSrcs, getDefaultStockPage(), ''].filter((s) => s != null)));
  for (const src of srcs) {
    // eslint-disable-next-line no-await-in-loop
    const assets = await getRegisteredAssetsCached(src);
    const hit = assets.find((a) => a.name === fileName);
    if (hit && hit.imageUrl) return hit.imageUrl;
  }
  return null;
};

// 変換 API のプレビュー用 URL を組み立てる(登録前に回転結果を確認する)。
// 方式1(file+src+rotate)で /convert を呼ぶ URL を返す。
export const buildConvertPreviewUrl = (file: string, src: string, rotate: number): string => {
  const api = getCadConvertApi();
  if (!api) return '';
  const sep = api.includes('?') ? '&' : '?';
  return `${api}${sep}file=${encodeURIComponent(file)}&src=${encodeURIComponent(src)}&rotate=${rotate}`;
};

// 添付ファイル(必要な項目のみ)
export interface Attachment {
  _id: string;
  originalName?: string;
  fileName?: string;
}

// GROWI の apiv3 GET ヘルパ
export const apiv3Get = async (
  endpoint: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> => {
  const query = new URLSearchParams(params).toString();
  const url = `/_api/v3${endpoint}${query ? `?${query}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`apiv3 GET failed: ${url} (${res.status})`);
  return res.json() as Promise<Record<string, unknown>>;
};

// ページ一覧レスポンスの形式差を吸収する。
const pageListFromResponse = (data: Record<string, unknown>): unknown[] | null => {
  const paginate = data.paginateResult as Record<string, unknown> | undefined;
  const nested = data.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    data.pages,
    data.docs,
    paginate?.docs,
    paginate?.pages,
    nested?.pages,
    nested?.docs,
  ];
  const pages = candidates.find((value) => Array.isArray(value));
  return Array.isArray(pages) ? pages : null;
};

const pageTotalFromResponse = (data: Record<string, unknown>): number | null => {
  const paginate = data.paginateResult as Record<string, unknown> | undefined;
  const nested = data.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    data.totalCount,
    data.total,
    paginate?.totalCount,
    paginate?.totalDocs,
    paginate?.total,
    nested?.totalCount,
    nested?.total,
  ];
  const value = candidates.find((candidate) => Number.isFinite(Number(candidate)) && Number(candidate) > 0);
  return value == null ? null : Number(value);
};

// 指定ページ直下の子ページを取得する。GROWI の pages/list は子孫を返す場合と
// 直下だけを返す場合があるため、取得結果を親直下に絞り込む。
export const listChildPages = async (parentPath: string): Promise<string[]> => {
  const parent = normalizePagePath(parentPath);
  if (!parent) return [];

  const pages: string[] = [];
  let offset = 0;
  const limit = 100;
  for (let i = 0; i < 1000; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const data = await apiv3Get('/pages/list', {
      path: parent,
      limit: String(limit),
      offset: String(offset),
    });
    const rawPages = pageListFromResponse(data);
    if (!rawPages) throw new Error('GROWI pages/list response does not contain a page array');
    for (const raw of rawPages) {
      const page = raw as Record<string, unknown>;
      const nested = page.page as Record<string, unknown> | undefined;
      const path = page.path || nested?.path;
      if (typeof path === 'string') pages.push(normalizePagePath(path));
    }
    const total = pageTotalFromResponse(data);
    offset += rawPages.length;
    if (rawPages.length === 0) break;
    if (total != null && offset >= total) break;
    if (total == null && rawPages.length < limit) break;
  }

  const prefix = parent === '/' ? '/' : `${parent}/`;
  return Array.from(new Set(pages))
    .filter((path) => path !== parent && path.startsWith(prefix))
    .filter((path) => !path.slice(prefix.length).includes('/'))
    .sort();
};

// ページ ID(MongoDB ObjectId, 24 桁の 16 進)かどうか。
const looksLikePageId = (s: string): boolean => /^[0-9a-f]{24}$/i.test(s);

// ページ ID からページパスを取得する(ID ベース URL の環境用)。
export const getPagePathById = async (pageId: string): Promise<string | null> => {
  try {
    const data = await apiv3Get('/page', { pageId });
    const d = data as Record<string, unknown>;
    const page = (d.page || (d.data as Record<string, unknown>)?.page || d) as
      | Record<string, unknown>
      | undefined;
    const path = page?.path;
    return typeof path === 'string' ? path : null;
  } catch (e) {
    console.error('[custom-map] failed to resolve page path by id', pageId, e);
    return null;
  }
};

// 現在ページのパス解決結果(確定できたものだけ)をキャッシュする(URL 単位)。
// 未確定(初回ロードでページ情報が未整備・API 解決失敗)のものはキャッシュせず、
// 次回呼び出しで再試行できるようにする。
const currentPathCache = new Map<string, Promise<string>>();

// パス解決の結果。resolved=true のときだけ path を信頼できる(実ページパス)。
// resolved=false は「まだ確定できない/失敗」で、暫定的に path(生 URL)を返す。
export interface CurrentPagePathResult {
  path: string;
  resolved: boolean;
}

// 現在表示中ページのパスを、確度付きで解決する。環境差を吸収する。
// 優先順位(重要):
//   1. window.GROWI_CONTEXT.page.path があればそれ(従来環境) → resolved
//   2. location.pathname の先頭がページ ID なら、必ず API でパス解決する → 成功で resolved
//      ※ このとき __NEXT_DATA__.currentPathname は信用しない。初回ロードでは
//        currentPathname が /login など「実ページと無関係の初期値」を指すことが
//        あり(実測)、それを実パスと誤認して /login を確定・キャッシュしてしまうと
//        リロードするまで直らないため。
//   3. location.pathname 自体が「/」始まりの実パス(ID でない)ならそれを使う。
//   4. 最後の手段として __NEXT_DATA__.currentPathname(実パス形式)を暫定採用。
//      ただし確定はできない(resolved=false)ためキャッシュしない。
// 「確定できた(resolved=true)」ケースだけをキャッシュするため、初回ロードで
// ページ情報が未整備でも、次の呼び出しで再解決できる(リロード不要)。
export const resolveCurrentPagePathResult = async (): Promise<CurrentPagePathResult> => {
  const fromContext = (window as unknown as { GROWI_CONTEXT?: { page?: { path?: string } } })
    .GROWI_CONTEXT?.page?.path;
  if (typeof fromContext === 'string' && fromContext.startsWith('/')) {
    return { path: fromContext, resolved: true };
  }

  const rawPath = typeof location !== 'undefined' ? location.pathname : '';
  const cached = currentPathCache.get(rawPath);
  if (cached) return { path: await cached, resolved: true };

  // URL パスの先頭セグメントがページ ID なら、API でパス解決する(最優先)。
  // ID ベース URL 環境の本筋。__NEXT_DATA__ は初回に古い値(/login 等)を持つ
  // ことがあるため、ここでは参照しない。
  const seg = rawPath.replace(/^\//, '').split('/')[0] || '';
  if (looksLikePageId(seg)) {
    const resolvedPath = await getPagePathById(seg);
    if (resolvedPath) {
      currentPathCache.set(rawPath, Promise.resolve(resolvedPath));
      return { path: resolvedPath, resolved: true };
    }
    // API 解決に失敗(セッション未確立・一時的な失敗等)。確定できないので
    // キャッシュせず、次回再試行できるようにする(unknown 相当)。
    return { path: rawPath, resolved: false };
  }

  // 生 URL が実パス形式(/ 始まりで ID でない)なら、それを実パスとして確定する。
  // location.pathname は現在ページを正しく指すため、__NEXT_DATA__ より信頼できる。
  if (rawPath.startsWith('/')) {
    currentPathCache.set(rawPath, Promise.resolve(rawPath));
    return { path: rawPath, resolved: true };
  }

  // 最後の手段: __NEXT_DATA__ の currentPathname(実パス形式)を暫定採用。
  // location から判断できない特殊ケース向け。確定はできないのでキャッシュしない。
  try {
    const cur = (window as unknown as {
      __NEXT_DATA__?: { props?: { pageProps?: { currentPathname?: string } } };
    }).__NEXT_DATA__?.props?.pageProps?.currentPathname;
    if (typeof cur === 'string' && cur.startsWith('/')) {
      const curSeg = cur.replace(/^\//, '').split('/')[0] || '';
      if (!looksLikePageId(curSeg)) {
        return { path: cur, resolved: false };
      }
    }
  } catch { /* noop */ }

  return { path: rawPath, resolved: false };
};

// 現在表示中ページのパスを解決する(パスのみ・後方互換 API)。
// 確度が不要な呼び出し向け。内部で resolveCurrentPagePathResult を使う。
export const resolveCurrentPagePath = async (): Promise<string> => {
  const { path } = await resolveCurrentPagePathResult();
  return path;
};

// ページ本文(保存済みの最新リビジョン)と、更新用の revisionId・パスをまとめて取得する。
// 既存記法の再編集で使う。GET /_api/v3/page?pageId= のレスポンス
// (page.revision.body / page.revision._id)を読む。取得できなければ null。
export interface PageBody {
  body: string;
  revisionId: string;
  path: string;
}

export const getPageBodyById = async (pageId: string): Promise<PageBody | null> => {
  try {
    const data = await apiv3Get('/page', { pageId });
    const d = data as Record<string, unknown>;
    const page = (d.page || (d.data as Record<string, unknown>)?.page || d) as
      | Record<string, unknown>
      | undefined;
    const revision = page?.revision as Record<string, unknown> | undefined;
    const body = revision?.body;
    const revisionId = revision?._id;
    const path = page?.path;
    if (typeof body !== 'string' || typeof revisionId !== 'string') return null;
    return {
      body,
      revisionId,
      path: typeof path === 'string' ? path : '',
    };
  } catch (e) {
    console.error('[custom-map] failed to get page body', pageId, e);
    return null;
  }
};

// ページ本文を更新する(既存記法の再編集の保存)。
// PUT /_api/v3/page に { pageId, revisionId, body, origin } を送る。
// revisionId が現在のリビジョンと食い違う場合、GROWI 側で更新が弾かれる
// (他者編集との競合を安全に検出)。origin は 'view'(表示側からの単発更新)。
// 成功可否を boolean で返す。失敗時はメッセージを添えて例外を投げる。
export const updatePageBody = async (
  pageId: string,
  revisionId: string,
  body: string,
): Promise<void> => {
  const res = await fetch('/_api/v3/page', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      pageId, revisionId, body, origin: 'view',
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const d = data as Record<string, unknown>;
    const errs = d.errors as Array<Record<string, unknown>> | undefined;
    const msg = (errs && errs[0] && errs[0].message)
      || d.message
      || `update page failed: ${res.status}`;
    throw new Error(String(msg));
  }
};

// ページパスから、そのページ ID を取得する
export const getPageIdByPath = async (pagePath: string): Promise<string | null> => {
  try {
    const data = await apiv3Get('/page', { path: pagePath });
    const d = data as Record<string, unknown>;
    const page = (d.page || (d.data as Record<string, unknown>)?.page || d) as
      | Record<string, unknown>
      | undefined;
    const id = page?._id || page?.id;
    return typeof id === 'string' ? id : null;
  } catch (e) {
    console.error('[custom-map] failed to resolve page id by path', pagePath, e);
    return null;
  }
};

// 添付一覧を「ページパス単位」でキャッシュする
const attachmentCache = new Map<string, Promise<Attachment[]>>();

// ページパスに紐づく添付一覧を取得(キャッシュ付き)
export const getAttachmentsForPage = (pagePath: string): Promise<Attachment[]> => {
  const cached = attachmentCache.get(pagePath);
  if (cached) return cached;

  const promise = (async (): Promise<Attachment[]> => {
    const pageId = await getPageIdByPath(pagePath);
    if (!pageId) return [];
    try {
      const data = await apiv3Get('/attachment/list', { pageId });
      const d = data as Record<string, unknown>;
      const list = (d.paginateResult as Record<string, unknown>)?.docs
        || d.docs
        || d.attachments
        || [];
      return Array.isArray(list) ? (list as Attachment[]) : [];
    } catch (e) {
      console.error('[custom-map] failed to fetch attachment list', pagePath, e);
      return [];
    }
  })();

  attachmentCache.set(pagePath, promise);
  return promise;
};

// 指定ページパスの添付一覧キャッシュを無効化する(アップロード直後に呼ぶ)。
export const invalidateAttachmentCache = (pagePath: string): void => {
  attachmentCache.delete(pagePath);
};

// アップロード結果(記法・表示に使う項目のみ)。
export interface UploadedAttachment {
  id: string;
  originalName: string; // 記法の photo= に使う元ファイル名
  url: string; // 表示用 URL(/attachment/<id>)
}

// 画像などを現在ページの添付としてアップロードする。
// GROWI の POST /_api/v3/attachment に multipart/form-data(file + page_id)を送る。
// CSRF トークンは不要で Cookie(セッション)認証。X-Requested-With を付ける
// (GROWI が XHR 判定に使う)。Content-Type は FormData 使用時ブラウザに任せる。
// 成功時に UploadedAttachment を返し、該当ページの添付キャッシュを無効化する。
export const uploadAttachment = async (
  pageId: string,
  file: File,
  pagePathForCache?: string,
): Promise<UploadedAttachment> => {
  const form = new FormData();
  form.append('file', file);
  form.append('page_id', pageId);

  const res = await fetch('/_api/v3/attachment', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const d = data as Record<string, unknown>;
    const errs = d.errors as Array<Record<string, unknown>> | undefined;
    const msg = (errs && errs[0] && errs[0].message)
      || d.message
      || `attachment upload failed: ${res.status}`;
    throw new Error(String(msg));
  }
  const data = await res.json() as Record<string, unknown>;
  const att = data.attachment as Record<string, unknown> | undefined;
  const id = att?._id || att?.id;
  const originalName = att?.originalName || att?.fileName;
  if (typeof id !== 'string' || typeof originalName !== 'string') {
    throw new Error('attachment upload: unexpected response');
  }
  // アップロード先ページの添付一覧キャッシュを無効化(直後の解決で拾えるように)。
  if (pagePathForCache) invalidateAttachmentCache(pagePathForCache);
  const url = (typeof att?.filePathProxied === 'string' && att.filePathProxied)
    || `/attachment/${id}`;
  return { id, originalName, url };
};

// 現在表示中ページの添付一覧(GROWI_CONTEXT から同期取得できる分)
const getCurrentPageAttachments = (): Attachment[] => {
  try {
    return (window as unknown as { GROWI_CONTEXT?: { page?: { attachments?: Attachment[] } } })
      .GROWI_CONTEXT?.page?.attachments || [];
  } catch {
    return [];
  }
};

const findAttachmentUrl = (attachments: Attachment[], fileName: string): string | null => {
  const found = attachments.find(
    (att) => att.originalName === fileName || att.fileName === fileName,
  );
  return found ? `/attachment/${found._id}` : null;
};

// 現在ログイン中のユーザーが管理者(admin)かどうかを返す。
// この環境では __NEXT_DATA__.props.pageProps.currentUser.admin に入る
// (GROWI_CONTEXT 側は null のことがある)。取得できなければ false。
// 用途: 一般ユーザーのコンソールを汚さないよう、診断ログを管理者時のみ出す。
export const isAdminUser = (): boolean => {
  try {
    const user = (window as unknown as {
      __NEXT_DATA__?: { props?: { pageProps?: { currentUser?: { admin?: boolean } } } };
    }).__NEXT_DATA__?.props?.pageProps?.currentUser;
    return !!(user && user.admin === true);
  } catch {
    return false;
  }
};

// ファイル名を、指定した候補ページ(パス)の順で探して URL を返す。見つからなければ null。
export const resolveAttachmentUrl = async (
  fileName: string,
  candidatePages: string[],
): Promise<string | null> => {
  if (!fileName) return null;

  const currentPath = (window as unknown as { GROWI_CONTEXT?: { page?: { path?: string } } })
    .GROWI_CONTEXT?.page?.path;
  if (currentPath && candidatePages.includes(currentPath)) {
    const hit = findAttachmentUrl(getCurrentPageAttachments(), fileName);
    if (hit) return hit;
  }

  for (const pagePath of candidatePages) {
    if (!pagePath) continue;
    // eslint-disable-next-line no-await-in-loop
    const attachments = await getAttachmentsForPage(pagePath);
    const hit = findAttachmentUrl(attachments, fileName);
    if (hit) return hit;
    // 見つからないときは、そのページで見えた添付名を出して原因(ファイル名不一致か
    // ページ違いか)を切り分けやすくする。一般ユーザーのコンソールを汚さないよう
    // 管理者ログイン時のみ出力する。
    if (isAdminUser()) {
      console.warn(
        `[custom-map] attachment "${fileName}" not found in page "${pagePath}". `
        + `available: [${attachments.map((a) => a.originalName || a.fileName || a._id).join(', ')}]`,
      );
    }
  }
  return null;
};

// 添付の URL と表示名(editor で使用)
export const attachmentUrl = (att: Attachment): string => `/attachment/${att._id}`;
export const attachmentName = (att: Attachment): string => att.originalName || att.fileName || att._id;

// 数値ユーティリティ
export const toNumber = (value: string | null | undefined, fallback: number): number => {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

// マーカーのピン径・ラベル文字サイズ(px)の既定値と範囲(画面崩れ防止のクランプ用)。
// viewer(描画)と editor(記法生成/パース/UI)で共有する。
export const PIN_SIZE_DEFAULT = 12;
export const PIN_SIZE_MIN = 6;
export const PIN_SIZE_MAX = 48;
export const LABEL_SIZE_DEFAULT = 12;
export const LABEL_SIZE_MIN = 8;
export const LABEL_SIZE_MAX = 40;

// 最小化(ラベル非表示・点滅)状態のピン径(px)。ユーザー指定の pinSize とは
// 無関係の固定値。ラベルが消えても場所が分かりクリックしやすいよう既定は
// やや大きめ。window.GROWI_CUSTOM_MAP_CONFIG.minimizedPinSize で上書き可能。
export const MINIMIZED_PIN_SIZE_DEFAULT = 24;
const MINIMIZED_PIN_SIZE_MIN = 8;
const MINIMIZED_PIN_SIZE_MAX = 64;

// 最小化ピン径を返す。設定があれば範囲内にクランプ、無ければ既定 24px。
export const getMinimizedPinSize = (): number => {
  const cfg = (window as unknown as { GROWI_CUSTOM_MAP_CONFIG?: { minimizedPinSize?: number } })
    .GROWI_CUSTOM_MAP_CONFIG;
  const raw = cfg && typeof cfg.minimizedPinSize === 'number' ? cfg.minimizedPinSize : NaN;
  if (!Number.isFinite(raw)) return MINIMIZED_PIN_SIZE_DEFAULT;
  return Math.min(MINIMIZED_PIN_SIZE_MAX, Math.max(MINIMIZED_PIN_SIZE_MIN, raw));
};

// 検索照合用に文字列を正規化する。NFKC で全角英数字・記号を半角に統一し、
// 小文字化する。これで「ＡＢＣ」と「abc」を区別せず絞り込める。
export const normalizeForSearch = (s: string): string => {
  if (!s) return '';
  try {
    return s.normalize('NFKC').toLowerCase();
  } catch {
    return s.toLowerCase();
  }
};

// 背景色(#rgb / #rrggbb / rgb(...) 等)に対して読みやすい文字色(黒/白)を返す。
// 輝度が高い(明るい)背景なら黒、暗い背景なら白。淡色ラベルでも読めるようにする。
export const textColorForBg = (bg: string): string => {
  const rgb = parseColorToRgb(bg);
  if (!rgb) return '#ffffff'; // 解釈できないときは従来どおり白
  const { r, g, b } = rgb;
  // 相対輝度(sRGB 近似)。0(暗)〜255(明)。
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? '#000000' : '#ffffff';
};

// 色文字列を RGB に解釈する。#rgb / #rrggbb / rgb(r,g,b) に対応。
const parseColorToRgb = (color: string): { r: number; g: number; b: number } | null => {
  if (!color) return null;
  const c = color.trim().toLowerCase();

  // #rrggbb または #rgb
  const hexMatch = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split('').map((ch) => ch + ch).join('');
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: Number(rgbMatch[1]),
      g: Number(rgbMatch[2]),
      b: Number(rgbMatch[3]),
    };
  }

  return null;
};

// ============================================================
// FAB ローディング表示の共通ユーティリティ
// ============================================================

// 回転アニメ(spinner)用の <style> を 1 度だけ document に注入する。
// FAB のローディング表示(パス解決中)で使う。
const SPINNER_STYLE_ID = 'growi-custom-map-spinner-style';

export const ensureSpinnerStyle = (): void => {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SPINNER_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SPINNER_STYLE_ID;
  style.textContent = `
@keyframes gcm-spin { to { transform: rotate(360deg); } }
.gcm-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 8px;
  vertical-align: -2px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: gcm-spin 0.8s linear infinite;
}
`;
  document.head.appendChild(style);
};

// ローディング表示中の FAB の中身(スピナー＋文言)を設定する。
// disabled 表示(半透明・カーソル既定)にして、解決中はクリックできないようにする。
export const setFabLoading = (fab: HTMLButtonElement, label: string): void => {
  ensureSpinnerStyle();
  fab.disabled = true;
  fab.style.opacity = '0.7';
  fab.style.cursor = 'default';
  fab.textContent = '';
  const spinner = document.createElement('span');
  spinner.className = 'gcm-spinner';
  fab.appendChild(spinner);
  fab.appendChild(document.createTextNode(label));
};

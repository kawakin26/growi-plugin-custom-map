import { visit } from 'unist-util-visit';
import remarkDirective from 'remark-directive';

declare const growiFacade: any;

// ==========================================
// 1. ページ内の添付ファイル名からURLを探す関数
// ==========================================
const getAttachmentUrlByName = (fileName: string): string => {
  try {
    const attachments = (window as any).GROWI_CONTEXT?.page?.attachments || [];
    const found = attachments.find((att: any) => att.originalName === fileName || att.fileName === fileName);
    if (found) {
      return `/attachment/${found._id}`;
    }
  } catch (e) {
    console.error("Failed to fetch attachment list from GROWI context", e);
  }
  return `/images/maps/${fileName}`;
};

// ==========================================
// 2. 描画されたHTML要素をボタン・モーダルに変換するメインロジック
// ==========================================
const initMapPopups = (): void => {
  // まだ処理されていないカスタムマップ要素をすべて取得
  const elements = document.querySelectorAll('div[data-plugin="custom-map"]:not([data-processed="true"])');

  elements.forEach((el: Element) => {
    const htmlEl = el as HTMLElement;
    htmlEl.setAttribute('data-processed', 'true'); // 二重処理防止

    // データ属性（パラメータ）を取得
    const file = htmlEl.getAttribute('data-file') || '';
    const x = htmlEl.getAttribute('data-x') || '50';
    const y = htmlEl.getAttribute('data-y') || '50';
    const text = htmlEl.getAttribute('data-text') || '';
    const color = htmlEl.getAttribute('data-color') || '#ff3b30';
    const zoom = htmlEl.getAttribute('data-zoom') === 'true';
    const cropScale = htmlEl.getAttribute('data-crop-scale') || '2';

    // 中身のテキスト（「ここをクリックしてマップを起動」など）を取得
    const buttonText = htmlEl.innerText.trim() || 'マップを開く';
    htmlEl.innerText = ''; // 一旦クリア

    // ─── A. ボタンの生成 ───
    const button = document.createElement('button');
    button.className = 'btn btn-outline-primary m-1';
    button.innerText = buttonText;
    htmlEl.appendChild(button);

    // 画像URLを取得
    const imageUrl = getAttachmentUrlByName(file);

    // ─── B. クリックイベントの登録（モーダルの動的生成） ───
    button.addEventListener('click', (e) => {
      e.preventDefault();

      // 既存のモーダルがあれば削除
      const oldModal = document.getElementById('growi-custom-map-modal');
      if (oldModal) oldModal.remove();

      // モーダル外枠
      const modal = document.createElement('div');
      modal.id = 'growi-custom-map-modal';
      Object.assign(modal.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center',
        zIndex: '9999'
      });

      // モーダルコンテンツカード
      const content = document.createElement('div');
      Object.assign(content.style, {
        position: 'relative', backgroundColor: '#fff', padding: '20px', borderRadius: '8px',
        maxWidth: '90vw', maxHeight: '90vh', boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
      });
      content.addEventListener('click', (ae) => ae.stopPropagation()); // 内側クリックで閉じないように

      // 閉じるボタン
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      Object.assign(closeBtn.style, {
        position: 'absolute', top: '-15px', right: '-15px', background: '#000', color: '#fff',
        border: 'none', borderRadius: '50%', width: '30px', height: '30px', fontSize: '20px',
        cursor: 'pointer', zIndex: '10', display: 'flex', justifyContent: 'center', alignItems: 'center'
      });
      closeBtn.addEventListener('click', () => modal.remove());

      // 画像コンテナ（はみ出し防止用）
      const imgContainer = document.createElement('div');
      Object.assign(imgContainer.style, {
        position: 'relative', overflow: 'hidden', maxWidth: '100%', maxHeight: '75vh'
      });

      // マップ画像本体
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = file;
      if (zoom) {
        Object.assign(img.style, {
          transform: `scale(${cropScale})`,
          transformOrigin: `${x}% ${y}%`,
          display: 'block', transition: 'transform 0.2s ease'
        });
      } else {
        Object.assign(img.style, {
          width: '100%', height: 'auto', display: 'block'
        });
      }

      // ピン要素
      const pin = document.createElement('div');
      Object.assign(pin.style, {
        position: 'absolute', left: `${x}%`, top: `${y}%`,
        width: '16px', height: '16px', backgroundColor: color,
        border: '2px solid #fff', borderRadius: '50%', transform: 'translate(-50%, -50%)',
        boxShadow: '0 2px 5px rgba(0,0,0,0.4)'
      });

      // ピンに付属するテキスト
      if (text) {
        const pinText = document.createElement('div');
        pinText.innerText = text;
        Object.assign(pinText.style, {
          position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          backgroundColor: color, color: '#fff', padding: '4px 8px', borderRadius: '4px',
          fontSize: '12px', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
        });
        pin.appendChild(pinText);
      }

      // 要素を組み立てて画面へ追加
      imgContainer.appendChild(img);
      imgContainer.appendChild(pin);
      content.appendChild(closeBtn);
      content.appendChild(imgContainer);
      modal.appendChild(content);

      // 背景クリックで閉じる
      modal.addEventListener('click', () => modal.remove());

      document.body.appendChild(modal);
    });
  });
};

// 画面の更新（ページ遷移やレンダリング）を監視して定期実行
if (typeof window !== 'undefined') {
  setInterval(initMapPopups, 1000);
}

// ==========================================
// 3. GROWIへのプラグイン登録とremarkの定義
// ==========================================
export const activate = (): void => {
  if (typeof growiFacade === 'undefined' || growiFacade == null || growiFacade.markdownRenderer == null) {
    return;
  }

  const { optionsGenerators } = growiFacade.markdownRenderer;
  const original = optionsGenerators.customGenerateViewOptions;

  optionsGenerators.customGenerateViewOptions = (...args: any[]) => {
    const options = original
      ? original(...args)
      : optionsGenerators.generateViewOptions(...args);

    // 1. remark-directive プラグインを登録
    options.remarkPlugins = options.remarkPlugins || [];
    if (!options.remarkPlugins.includes(remarkDirective)) {
      options.remarkPlugins.push(remarkDirective);
    }

    // 2. 自作のカスタムマップノード変換ロジックを注入
    options.remarkPlugins.push(() => {
      return (tree: any) => {
        visit(tree, (node) => {
          if (node.type === 'containerDirective' && node.name === 'custom-map') {
            const attributes = node.attributes || {};

            // Reactコンポーネントを通さず、安全な標準div要素としてHTMLに出力
            node.type = 'htmlBlock';
            node.data = {
              hName: 'div',
              hProperties: {
                'data-plugin': 'custom-map',
                ...attributes
              }
            };
          }
        });
      };
    });

    return options;
  };
};

export const deactivate = (): void => {
  // クリーンアップ処理
};

// ==========================================
// 4. プラグインアクティベーターの定義
// ==========================================
const pluginDefinition = {
  activate,
  deactivate,
  activatePlugin: activate,
  deactivatePlugin: deactivate,
};

if (typeof window !== 'undefined') {
  const windowAsAny = window as any;
  windowAsAny.pluginActivators = windowAsAny.pluginActivators || {};
  windowAsAny.pluginActivators['growi-plugin-custom-map'] = pluginDefinition;
}

export default pluginDefinition;

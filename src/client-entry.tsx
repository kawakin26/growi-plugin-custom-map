import React, { useState } from 'react';
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
// 2. ポップアップモーダルのReactコンポーネント
// ==========================================
interface MapPopupProps {
  file: string;
  x: string;
  y: string;
  text?: string;
  color?: string;
  zoom?: string;
  cropScale?: string;
  children: React.ReactNode;
}

const MapPopupButton: React.FC<MapPopupProps> = ({
  file, x, y, text = '', color = '#ff3b30', zoom = 'false', cropScale = '2', children
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const imageUrl = getAttachmentUrlByName(file);
  const isZoomed = zoom === 'true';

  const modalStyle: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
    backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center',
    zIndex: 2500
  };

  const imgStyle: React.CSSProperties = isZoomed ? {
    transform: `scale(${cropScale})`,
    transformOrigin: `${x}% ${y}%`,
    display: 'block', transition: 'transform 0.2s ease'
  } : {
    width: '100%', height: 'auto', display: 'block'
  };

  return (
    <>
      <button className="btn btn-outline-primary m-1" onClick={() => setIsOpen(true)}>
        {children || 'マップを開く'}
      </button>

      {isOpen && (
        <div style={modalStyle} onClick={() => setIsOpen(false)}>
          <div
            style={{ position: 'relative', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', maxWidth: '90vw', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsOpen(false)}
              style={{ position: 'absolute', top: '-15px', right: '-15px', background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer' }}
            >
              &times;
            </button>

            <div style={{ position: 'relative', overflow: 'hidden', maxWidth: '100%', maxHeight: '75vh' }}>
              <img src={imageUrl} alt={file} style={imgStyle} />

              <div style={{
                position: 'absolute', left: `${x}%`, top: `${y}%`,
                width: '16px', height: '16px', backgroundColor: color,
                border: '2px solid #fff', borderRadius: '50%', transform: 'translate(-50%, -50%)',
                boxShadow: '0 2px 5px rgba(0,0,0,0.4)'
              }}>
                {text && (
                  <div style={{
                    position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                    backgroundColor: color, color: '#fff', padding: '4px 8px', borderRadius: '4px',
                    fontSize: '12px', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}>
                    {text}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

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
            node.type = 'customMapNode';

            // 💡 GROWIのコンポーネントマッパーが認識できるようにデータを整形
            node.data = {
              hName: 'custom-map-button', // 小文字ハイフン繋ぎの独自タグ名にする
              hProperties: {
                'data-plugin': 'custom-map',
                ...attributes
              }
            };
          }
        });
      };
    });

    // 3. Rehype / Reactコンポーネントの登録
    // GROWIが描画時に参照する全てのコンポーネント保持プロパティに対して、網羅的に登録します
    const renderComponent = (props: any) => {
      const { file, x, y, text, color, zoom, cropScale, children } = props;
      return (
        <MapPopupButton
          file={file} x={x} y={y} text={text}
          color={color} zoom={zoom} cropScale={cropScale}
        >
          {children}
        </MapPopupButton>
      );
    };

    // GROWIの複数のレンダラー仕様（バージョンごとの差異）に対応するため、すべてにマッピング
    options.components = options.components || {};
    options.components['custom-map-button'] = renderComponent;
    options.components.customMapNode = renderComponent;

    options.componentMap = options.componentMap || {};
    options.componentMap['custom-map-button'] = renderComponent;
    options.componentMap.customMapNode = renderComponent;

    return options;
  };
};


export const deactivate = (): void => {
  // 必要に応じてクリーンアップ処理を記述
};

// ==========================================
// 4. プラグインアクティベーターの定義（両方の仕様に対応）
// ==========================================
const pluginDefinition = {
  activate,
  deactivate,
  activatePlugin: activate,     // GROWIの別形式用のエイリアス
  deactivatePlugin: deactivate, // GROWIの別形式用のエイリアス
};

if (typeof window !== 'undefined') {
  const windowAsAny = window as any;
  windowAsAny.pluginActivators = windowAsAny.pluginActivators || {};

  // ⚠️ package.json の name フィールドと完全に一致させて登録
  windowAsAny.pluginActivators['growi-plugin-custom-map'] = pluginDefinition;
}

// 標準的なモジュールエクスポートもサポート
export default pluginDefinition;

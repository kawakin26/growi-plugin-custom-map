import React, { useState } from 'react';
import { visit } from 'unist-util-visit';
import remarkDirective from 'remark-directive';

// ==========================================
// 1. ページ内の添付ファイル名からURLを探す関数
// ==========================================
const getAttachmentUrlByName = (fileName: string): string => {
  try {
    // GROWIがグローバルに保持しているページ情報や添付ファイルリストを参照します
    // ※環境やGROWIの内部仕様により変数名が異なる場合があります
    const attachments = (window as any).GROWI_CONTEXT?.page?.attachments || [];
    const found = attachments.find((att: any) => att.originalName === fileName || att.fileName === fileName);

    if (found) {
      return `/attachment/${found._id}`;
    }
  } catch (e) {
    console.error("Failed to fetch attachment list from GROWI context", e);
  }
  // 見つからない場合はフォールバックとしてプレースホルダーやそのままの文字列を返す
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
      {/* 画面上の起動ボタン（GROWIの標準ボタンクラススタイルを適用） */}
      <button className="btn btn-outline-primary m-1" onClick={() => setIsOpen(true)}>
        {children || 'マップを開く'}
      </button>

      {/* ポップアップモーダル本体 */}
      {isOpen && (
        <div style={modalStyle} onClick={() => setIsOpen(false)}>
          <div
            style={{ position: 'relative', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', maxWidth: '90vw', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()} // モーダル内クリックで閉じないように
          >
            {/* 閉じるボタン */}
            <button
              onClick={() => setIsOpen(false)}
              style={{ position: 'absolute', top: '-15px', right: '-15px', background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer' }}
            >
              &times;
            </button>

            {/* 画像コンテナ */}
            <div style={{ position: 'relative', overflow: 'hidden', maxWidth: '100%', maxHeight: '75vh' }}>
              <img src={imageUrl} alt={file} style={imgStyle} />

              {/* ピンの配置 */}
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
export const init = (context: any) => {
  // GROWIのMarkdownレンダラーのオプションオブジェクトを取得
  const { options } = context;

  // 1. remark-directive（::: 記法を解析する公式プラグイン）を有効化
  options.remarkPlugins.push(remarkDirective);

  // 2. 自作のカスタムマップ解析ロジックを注入
  options.remarkPlugins.push(() => {
    return (tree: any) => {
      visit(tree, (node) => {
        // :::custom-map 記法を検出
        if (node.type === 'containerDirective' && node.name === 'custom-map') {
          const attributes = node.attributes || {};

          // ノードのタイプを独自のものに書き換え、属性を格納
          node.type = 'customMapNode';
          node.data = {
            hName: 'div', // フォールバック用のタグ
            hProperties: {
              'data-plugin': 'custom-map',
              ...attributes
            }
          };
        }
      });
    };
  });

  // 3. rehype / Reactコンポーネントとしての描画マッピングを登録
  // GROWIのカスタム要素レンダラー（CustomComponentMapなど）にコンポーネントを紐付けます
  if (options.componentMap) {
    options.componentMap.customMapNode = (props: any) => {
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
  }
};

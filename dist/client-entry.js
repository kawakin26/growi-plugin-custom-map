"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const unist_util_visit_1 = require("unist-util-visit");
const remark_directive_1 = __importDefault(require("remark-directive"));
// ==========================================
// 1. ページ内の添付ファイル名からURLを探す関数
// ==========================================
const getAttachmentUrlByName = (fileName) => {
    try {
        // GROWIがグローバルに保持しているページ情報や添付ファイルリストを参照します
        // ※環境やGROWIの内部仕様により変数名が異なる場合があります
        const attachments = window.GROWI_CONTEXT?.page?.attachments || [];
        const found = attachments.find((att) => att.originalName === fileName || att.fileName === fileName);
        if (found) {
            return `/attachment/${found._id}`;
        }
    }
    catch (e) {
        console.error("Failed to fetch attachment list from GROWI context", e);
    }
    // 見つからない場合はフォールバックとしてプレースホルダーやそのままの文字列を返す
    return `/images/maps/${fileName}`;
};
const MapPopupButton = ({ file, x, y, text = '', color = '#ff3b30', zoom = 'false', cropScale = '2', children }) => {
    const [isOpen, setIsOpen] = (0, react_1.useState)(false);
    const imageUrl = getAttachmentUrlByName(file);
    const isZoomed = zoom === 'true';
    const modalStyle = {
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center',
        zIndex: 2500
    };
    const imgStyle = isZoomed ? {
        transform: `scale(${cropScale})`,
        transformOrigin: `${x}% ${y}%`,
        display: 'block', transition: 'transform 0.2s ease'
    } : {
        width: '100%', height: 'auto', display: 'block'
    };
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("button", { className: "btn btn-outline-primary m-1", onClick: () => setIsOpen(true), children: children || 'マップを開く' }), isOpen && ((0, jsx_runtime_1.jsx)("div", { style: modalStyle, onClick: () => setIsOpen(false), children: (0, jsx_runtime_1.jsxs)("div", { style: { position: 'relative', backgroundColor: '#fff', padding: '20px', borderRadius: '8px', maxWidth: '90vw', maxHeight: '90vh' }, onClick: (e) => e.stopPropagation(), children: [(0, jsx_runtime_1.jsx)("button", { onClick: () => setIsOpen(false), style: { position: 'absolute', top: '-15px', right: '-15px', background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: '30px', height: '30px', cursor: 'pointer' }, children: "\u00D7" }), (0, jsx_runtime_1.jsxs)("div", { style: { position: 'relative', overflow: 'hidden', maxWidth: '100%', maxHeight: '75vh' }, children: [(0, jsx_runtime_1.jsx)("img", { src: imageUrl, alt: file, style: imgStyle }), (0, jsx_runtime_1.jsx)("div", { style: {
                                        position: 'absolute', left: `${x}%`, top: `${y}%`,
                                        width: '16px', height: '16px', backgroundColor: color,
                                        border: '2px solid #fff', borderRadius: '50%', transform: 'translate(-50%, -50%)',
                                        boxShadow: '0 2px 5px rgba(0,0,0,0.4)'
                                    }, children: text && ((0, jsx_runtime_1.jsx)("div", { style: {
                                            position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
                                            backgroundColor: color, color: '#fff', padding: '4px 8px', borderRadius: '4px',
                                            fontSize: '12px', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                                        }, children: text })) })] })] }) }))] }));
};
// ==========================================
// 3. GROWIへのプラグイン登録とremarkの定義
// ==========================================
const init = (context) => {
    // GROWIのMarkdownレンダラーのオプションオブジェクトを取得
    const { options } = context;
    // 1. remark-directive（::: 記法を解析する公式プラグイン）を有効化
    options.remarkPlugins.push(remark_directive_1.default);
    // 2. 自作のカスタムマップ解析ロジックを注入
    options.remarkPlugins.push(() => {
        return (tree) => {
            (0, unist_util_visit_1.visit)(tree, (node) => {
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
        options.componentMap.customMapNode = (props) => {
            const { file, x, y, text, color, zoom, cropScale, children } = props;
            return ((0, jsx_runtime_1.jsx)(MapPopupButton, { file: file, x: x, y: y, text: text, color: color, zoom: zoom, cropScale: cropScale, children: children }));
        };
    }
};
exports.init = init;

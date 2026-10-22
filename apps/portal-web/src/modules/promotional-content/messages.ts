import type {InterfaceLanguage} from '../../language';

export const promoMessages = {
  heading: ['宣傳圖開發預覽', 'Promotional image preview', '告知画像の開発プレビュー', '홍보 이미지 개발 미리보기', 'Vista previa de imágenes promocionales'],
  notice: ['此預覽不保存內容；離頁前請先下載圖片。', 'This preview does not save content. Download your image before leaving.', 'このプレビューでは内容は保存されません。移動前に画像をダウンロードしてください。', '이 미리보기는 내용을 저장하지 않습니다. 나가기 전에 이미지를 다운로드하세요.', 'Esta vista previa no guarda el contenido. Descarga la imagen antes de salir.'],
  editor: ['編輯圖片文字', 'Edit image text', '画像のテキストを編集', '이미지 텍스트 편집', 'Editar el texto de la imagen'],
  label: ['分類文字', 'Category label', 'カテゴリ', '분류 문구', 'Etiqueta de categoría'],
  headline: ['主標題', 'Headline', '見出し', '제목', 'Título'],
  body: ['內文', 'Body', '本文', '본문', 'Texto'],
  footer: ['頁尾文字', 'Footer', 'フッター', '하단 문구', 'Pie de imagen'],
  ratio: ['圖片比例', 'Image ratio', '画像の比率', '이미지 비율', 'Proporción de la imagen'],
  square: ['正方形 1:1', 'Square 1:1', '正方形 1:1', '정사각형 1:1', 'Cuadrada 1:1'],
  portrait: ['直式 4:5', 'Portrait 4:5', '縦長 4:5', '세로 4:5', 'Vertical 4:5'],
  accent: ['裝飾色', 'Accent color', 'アクセント色', '강조색', 'Color de acento'],
  preview: ['圖片預覽', 'Image preview', '画像プレビュー', '이미지 미리보기', 'Vista previa de la imagen'],
  preparing: ['正在準備圖片…', 'Preparing image…', '画像を準備中…', '이미지 준비 중…', 'Preparando la imagen…'],
  ready: ['PNG 已準備好', 'PNG ready', 'PNG の準備ができました', 'PNG 준비 완료', 'PNG listo'],
  download: ['下載 PNG', 'Download PNG', 'PNG をダウンロード', 'PNG 다운로드', 'Descargar PNG'],
  started: ['已開始下載', 'Download started', 'ダウンロードを開始しました', '다운로드 시작됨', 'Descarga iniciada'],
  retry: ['重新產生預覽', 'Retry preview', 'プレビューを再試行', '미리보기 다시 시도', 'Reintentar vista previa'],
  overflow: ['「{field}」放不下，請縮短內容或減少換行。', '{field} does not fit. Shorten the text or use fewer line breaks.', '「{field}」が収まりません。文章または改行を減らしてください。', '{field}이(가) 영역을 벗어납니다. 글이나 줄바꿈을 줄이세요.', '{field} no cabe. Acorta el texto o usa menos saltos de línea.'],
  fieldError: ['請檢查「{field}」；主標題不可空白。', 'Check {field}. The headline cannot be empty.', '「{field}」を確認してください。見出しは必須です。', '{field}을(를) 확인하세요. 제목은 비워 둘 수 없습니다.', 'Revisa {field}. El título no puede estar vacío.'],
  fontsError: ['字型尚未準備好，請重試。', 'Fonts are not ready. Try again.', 'フォントを準備できませんでした。再試行してください。', '글꼴이 준비되지 않았습니다. 다시 시도하세요.', 'Las fuentes no están listas. Inténtalo de nuevo.'],
  renderError: ['圖片未能完成，請重試。', 'The image could not be completed. Try again.', '画像を作成できませんでした。再試行してください。', '이미지를 완성하지 못했습니다. 다시 시도하세요.', 'No se pudo completar la imagen. Inténtalo de nuevo.'],
  theme: ['介面外觀', 'Interface theme', '表示テーマ', '화면 테마', 'Tema de la interfaz'],
  light: ['明亮', 'Light', 'ライト', '밝게', 'Claro'],
  dark: ['夜航', 'Night', 'ダーク', '어둡게', 'Oscuro'],
  versefolk: ['敘生', 'Versefolk', 'Versefolk', 'Versefolk', 'Versefolk'],
  sample: ['範例文字可直接替換，介面切換語言不會翻譯你的內容。', 'Replace the sample text. Changing the interface language keeps your content as written.', 'サンプルを置き換えてください。表示言語を変えても入力内容は翻訳されません。', '예시 문구를 바꾸세요. 화면 언어를 바꿔도 입력 내용은 번역되지 않습니다.', 'Sustituye el texto de ejemplo. Cambiar el idioma de la interfaz conserva tu contenido original.'],
} satisfies Record<string, readonly [string, string, string, string, string]>;

export type PromoMessage = keyof typeof promoMessages;
const indexes: Record<InterfaceLanguage, number> = {'zh-Hant': 0, en: 1, ja: 2, ko: 3, es: 4};
export function promoText(language: InterfaceLanguage, key: PromoMessage, values: Record<string, string> = {}): string {
  return promoMessages[key][indexes[language]].replace(/\{([a-z]+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? values[name] : whole);
}

/**
 * Shopifyの注文Webhookを受信し、
 * 対象SKUの商品が含まれている場合に
 * ChatWorkへ通知するスクリプト
 */

/***************
 * 設定（ここだけ埋める）
 ***************/
const SS_ID = "***";
const SKU_SHEET_NAME = "***";      // A列に通知したいSKU
const PROCESSED_SHEET_NAME = "***"; // 重複防止（空でOK）

const CHATWORK_TOKEN = "***";
const CHATWORK_ROOM_ID = "***";

/***************
 * Webhook受信（Shopify -> GAS）
 ***************/
function doPost(e) {
  const ss = SpreadsheetApp.openById(SS_ID);
  const errorSheet = ss.getSheetByName("webhook_error") || ss.insertSheet("webhook_error");

  try {
    const body = e && e.postData && e.postData.contents ? e.postData.contents : "";
    const data = body ? JSON.parse(body) : {};

    // 注文ID（重複防止用）
    const orderId = data.id;
    if (!orderId) return ok_();

    // processedシート（重複防止）
    const processedSheet = ss.getSheetByName(PROCESSED_SHEET_NAME) || ss.insertSheet(PROCESSED_SHEET_NAME);
    if (isProcessed_(processedSheet, orderId)) return ok_();

    // SKUマスタ
    const skuSheet = ss.getSheetByName(SKU_SHEET_NAME);
    if (!skuSheet) return ok_();
    const targetSkuSet = loadTargetSkuSet_(skuSheet);

    // 注文内の商品（line_items）から「対象SKUだけ」抽出
    const lineItems = Array.isArray(data.line_items) ? data.line_items : [];
    const matchedTitles = [];

    for (const item of lineItems) {
      const sku = item && item.sku ? String(item.sku).trim() : "";
      if (!sku) continue;
      if (targetSkuSet.has(sku)) {
        const title = item.title ? String(item.title).trim() : "";
        const variant = item.variant_title ? String(item.variant_title).trim() : "";

        let displayTitle = title;

        if (variant && variant !== "null") {
          displayTitle += `（${variant}）`;
        }

        if (displayTitle) matchedTitles.push(displayTitle);
      }
    }

    // 対象SKUがなければ何もしない
    if (matchedTitles.length === 0) return ok_();

    // フォーマット用の情報
    const orderDate = formatOrderDate_(data.created_at); // "yyyy-MM-dd HH:mm"
    const orderNumber = data.name ? String(data.name) : "";
    const customerName = buildCustomerName_(data.customer); // "姓名様" or ""（無ければ空）

    // ChatWorkに送るメッセージ（相手指定フォーマット）
    const message =
      `[info][title]商品が売れました[/title]\n\n` +
      `${matchedTitles.join("\n")}\n\n` +
      `購入日時：${orderDate}\n` +
      `注文番号：${orderNumber}\n` +
      `ご購入者様：${customerName}` +
      `[/info]`;

    // 送信
    sendChatwork_(message);

    // 処理済み記録（orderIdだけでOK。必要なら日時も）
    processedSheet.appendRow([orderId, new Date(), orderNumber]);

    return ok_();

  } catch (err) {
    // エラー内容をシートに残す（JSON全量は危険なので先頭のみ）
    const msg = (err && err.stack) ? err.stack : String(err);
    const bodyHead = (e && e.postData && e.postData.contents) ? String(e.postData.contents).slice(0, 500) : "";
    errorSheet.appendRow([new Date(), "doPost ERROR", msg, bodyHead]);
    return ContentService.createTextOutput("ERROR").setMimeType(ContentService.MimeType.TEXT);
  }
}

/***************
 * 生存確認
 ***************/
function doGet() {
  return ContentService.createTextOutput("alive");
}

function ok_() {
  return ContentService.createTextOutput("OK").setMimeType(ContentService.MimeType.TEXT);
}

/***************
 * SKUマスタ読み込み
 ***************/
function loadTargetSkuSet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return new Set();

  const values = sheet.getRange(1, 1, lastRow, 1).getValues();
  return new Set(values.flat().map(v => String(v).trim()).filter(v => v));
}

/***************
 * 重複チェック（processedが空でも落ちない版）
 ***************/
function isProcessed_(sheet, orderId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return false;

  const values = sheet.getRange(1, 1, lastRow, 1).getValues().flat();
  return values.includes(orderId);
}

/***************
 * ChatWork送信
 ***************/
function sendChatwork_(bodyText) {
  const url = `https://api.chatwork.com/v2/rooms/${CHATWORK_ROOM_ID}/messages`;
  const options = {
    method: "post",
    headers: { "X-ChatWorkToken": CHATWORK_TOKEN },
    payload: { body: bodyText },
    muteHttpExceptions: true, // 失敗時も例外にせずレスポンス取れる（ログに残したい場合に便利）
  };

  const res = UrlFetchApp.fetch(url, options);

  // 必要なら、失敗レスポンスをエラーとして投げる（今回は運用優先でコメントアウト）
  // const code = res.getResponseCode();
  // if (code < 200 || code >= 300) throw new Error(`ChatWork API Error: ${code} ${res.getContentText()}`);
}

/***************
 * 表示用：購入日フォーマット（日本時間）
 ***************/
function formatOrderDate_(createdAt) {
  if (!createdAt) return "";

  const d = new Date(createdAt);
  // createdAtが不正だと "Invalid Date" になるのでガード
  if (isNaN(d.getTime())) return String(createdAt);

  return Utilities.formatDate(d, "Asia/Tokyo", "yyyy-MM-dd HH:mm");
}

/***************
 * 表示用：お客様名（姓+名+様）
 ***************/
function buildCustomerName_(customer) {
  if (!customer) return "";

  const last = customer.last_name ? String(customer.last_name) : "";
  const first = customer.first_name ? String(customer.first_name) : "";
  const full = (last + first).trim();

  return full ? `${full}様` : "";
}

/***************
 * （任意）ChatWork単体テスト
 ***************/
function testChatwork() {
  const message = "[info][title]テスト通知[/title]GASから直接送信テストです[/info]";
  sendChatwork_(message);
}

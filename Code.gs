// ==============================================
// 出張経費申請システム - Google Apps Script
// ==============================================
// 以下にスプレッドシートIDを設定してください
var SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';
var SHEET_NAME = 'Sheet1';

/**
 * ウェブアプリとしてHTMLを配信
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('出張経費申請システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 現在のユーザーのメールアドレスを取得
 */
function getUserEmail() {
  return Session.getActiveUser().getEmail();
}

/**
 * 日付文字列をyyyymmdd形式に変換
 * @param {string} dateStr - yyyy-mm-dd形式の日付文字列
 * @return {string} yyyymmdd形式の文字列
 */
function formatDateToYYYYMMDD(dateStr) {
  return String(dateStr).replace(/-/g, '');
}

/**
 * スプレッドシートから値を取得する際、日付データを安全に文字列化
 * @param {*} value - セルの値（Date型、数値型、文字列型のいずれか）
 * @return {string} yyyymmdd形式の文字列
 */
function ensureDateString(value) {
  if (value instanceof Date) {
    var y = value.getFullYear();
    var m = ('0' + (value.getMonth() + 1)).slice(-2);
    var d = ('0' + value.getDate()).slice(-2);
    return String(y) + m + d;
  }
  var s = String(value);
  // 数値として読まれた場合でも8桁であればそのまま返す
  if (/^\d{8}$/.test(s)) {
    return s;
  }
  return s;
}

/**
 * 新しい申請レコードを追加
 * @param {Object} formData - フォームデータ
 * @return {Object} 結果
 *
 * スプレッドシートの列構成:
 *  1: 名前  2: 部署  3: 役職  4: 出張先
 *  5: 日時(yyyymmdd)  6: 地区  7: 公共交通費  8: その他費用
 *  9: メールアドレス（自動記録）
 */
function addRecord(formData) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  var email = Session.getActiveUser().getEmail();
  var dateStr = formatDateToYYYYMMDD(formData.date);

  sheet.appendRow([
    formData.name,
    formData.department,
    formData.position,
    formData.destination,
    dateStr,
    formData.district,
    Number(formData.transportCost) || 0,
    Number(formData.otherCost) || 0,
    email
  ]);

  // 日付列をテキスト形式に設定（自動変換防止）
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 5).setNumberFormat('@');

  return { success: true, message: '申請が正常に登録されました。' };
}

/**
 * 全レコードを取得
 * @return {Array} レコードの配列
 */
function getAllRecords() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) return [];

  var lastCol = Math.max(sheet.getLastColumn(), 9);
  var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  return data.map(function(row, index) {
    return {
      rowIndex: index + 1,
      name: String(row[0]),
      department: String(row[1]),
      position: String(row[2]),
      destination: String(row[3]),
      date: ensureDateString(row[4]),
      district: String(row[5]),
      transportCost: Number(row[6]) || 0,
      otherCost: Number(row[7]) || 0,
      email: String(row[8] || '')
    };
  });
}

/**
 * レコードを更新
 * @param {number} rowIndex - 行番号（1始まり）
 * @param {Object} formData - 更新データ
 * @return {Object} 結果
 */
function updateRecord(rowIndex, formData) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  var dateStr = formatDateToYYYYMMDD(formData.date);

  sheet.getRange(rowIndex, 1, 1, 8).setValues([[
    formData.name,
    formData.department,
    formData.position,
    formData.destination,
    dateStr,
    formData.district,
    Number(formData.transportCost) || 0,
    Number(formData.otherCost) || 0
  ]]);

  // 日付列をテキスト形式に設定
  sheet.getRange(rowIndex, 5).setNumberFormat('@');

  return { success: true, message: '申請内容が更新されました。' };
}

/**
 * レコードを削除
 * @param {number} rowIndex - 行番号（1始まり）
 * @return {Object} 結果
 */
function deleteRecord(rowIndex) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  sheet.deleteRow(rowIndex);
  return { success: true, message: '申請が削除されました。' };
}

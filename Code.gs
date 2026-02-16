// =====================================================
// 出張経費申請システム - Code.gs
// =====================================================

// ★★★ スプレッドシートのIDをここに入力してください ★★★
var SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';

// スプレッドシートの列構成:
// A(1):名前  B(2):部署  C(3):役職  D(4):出張先
// E(5):日付(yyyymmdd)  F(6):地区  G(7):公共交通費
// H(8):その他費用  I(9):メールアドレス

/**
 * Webアプリのエントリーポイント
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('出張経費申請システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 現在のログインユーザーのメールアドレスを取得
 */
function getUserEmail() {
  try {
    var email = Session.getActiveUser().getEmail();
    return email || '';
  } catch (e) {
    return '';
  }
}

/**
 * スプレッドシートから全データを取得
 * 戻り値: オブジェクトの配列（行番号付き）
 */
function getData() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheets()[0];
    var lastRow = sheet.getLastRow();

    if (lastRow < 1) {
      return [];
    }

    var data = sheet.getRange(1, 1, lastRow, 9).getValues();
    var result = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      // 空行をスキップ
      if (!row[0] && !row[1] && !row[2]) continue;

      result.push({
        rowIndex: i + 1,
        name:          String(row[0] || ''),
        department:    String(row[1] || ''),
        position:      String(row[2] || ''),
        destination:   String(row[3] || ''),
        date:          String(row[4] || ''), // yyyymmdd 文字列
        district:      String(row[5] || ''),
        transportCost: Number(row[6]) || 0,
        otherCost:     Number(row[7]) || 0,
        email:         String(row[8] || '')
      });
    }

    return result;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 新規データをスプレッドシートに保存
 * formData.date は yyyymmdd 形式の文字列（クライアント側で変換済み）
 */
function saveData(formData) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheets()[0];
    var email = getUserEmail();

    sheet.appendRow([
      formData.name,
      formData.department,
      formData.position,
      formData.destination,
      formData.date,           // yyyymmdd 文字列
      formData.district,
      Number(formData.transportCost) || 0,
      Number(formData.otherCost)     || 0,
      email
    ]);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 既存データを更新
 * rowIndex: スプレッドシートの行番号（1始まり）
 */
function updateData(rowIndex, formData) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheets()[0];

    sheet.getRange(rowIndex, 1, 1, 9).setValues([[
      formData.name,
      formData.department,
      formData.position,
      formData.destination,
      formData.date,           // yyyymmdd 文字列
      formData.district,
      Number(formData.transportCost) || 0,
      Number(formData.otherCost)     || 0,
      formData.email
    ]]);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 指定行のデータを削除
 * rowIndex: スプレッドシートの行番号（1始まり）
 */
function deleteData(rowIndex) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheets()[0];
    sheet.deleteRow(rowIndex);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

"""kabutan.jp（株探）から銘柄別の信用残高（週次）データをスクレイピングする。

データソース:
  - kabutan.jp の銘柄別信用残ページ
  - 週次更新（毎週金曜日時点のデータが翌火曜に公表）
  - 売残、買残、信用倍率、前週比が含まれる

注意:
  - 私的利用の範囲内で使用すること
  - リクエスト間隔を十分に空けること（config.REQUEST_DELAY 参照）
  - サイト構造が変更された場合は _parse_margin_table() を調整する
"""

import logging
import os
import re
import time
from datetime import datetime

import pandas as pd
import requests
from bs4 import BeautifulSoup
from tqdm import tqdm

from config import (
    KABUTAN_BASE_URL,
    MARGIN_PAGES_PER_STOCK,
    MAX_RETRIES,
    RAW_DIR,
    REQUEST_DELAY,
    REQUEST_TIMEOUT,
    USER_AGENT,
)

logger = logging.getLogger(__name__)

MARGIN_RAW_DIR = os.path.join(RAW_DIR, "margin")


def _get_session() -> requests.Session:
    """スクレイピング用のHTTPセッションを作成する。"""
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
            "Accept-Encoding": "gzip, deflate",
            "Connection": "keep-alive",
        }
    )
    return session


def _parse_number(text: str) -> float | None:
    """カンマ付き数値文字列をfloatに変換する。

    例: "1,234,567" → 1234567.0
        "+12,345" → 12345.0
        "-23,456" → -23456.0
        "---" → None
    """
    if not text or text.strip() in ("---", "-", ""):
        return None
    cleaned = text.strip().replace(",", "").replace("+", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_date(date_str: str) -> str | None:
    """日付文字列をYYYY-MM-DD形式に変換する。

    kabutan.jpの日付フォーマット:
      - "25/01/10" → "2025-01-10"
      - "2025/01/10" → "2025-01-10"
      - "2025年01月10日" → "2025-01-10"
    """
    date_str = date_str.strip()
    patterns = [
        (r"(\d{2})/(\d{2})/(\d{2})", "%y/%m/%d"),
        (r"(\d{4})/(\d{2})/(\d{2})", "%Y/%m/%d"),
        (r"(\d{4})年(\d{2})月(\d{2})日", None),
    ]
    for pattern, fmt in patterns:
        m = re.match(pattern, date_str)
        if m:
            if fmt:
                try:
                    dt = datetime.strptime(date_str, fmt)
                    return dt.strftime("%Y-%m-%d")
                except ValueError:
                    continue
            else:
                return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def _parse_margin_table(soup: BeautifulSoup) -> list[dict]:
    """HTMLから信用残高テーブルを探してパースする。

    kabutan.jp の信用残ページは以下のような構造を想定:
    - テーブルに「売残」「買残」等のヘッダーが含まれる
    - 列順: 日付, 売残, 前週比, 買残, 前週比, 信用倍率

    サイト構造が変更された場合はここを修正する。
    """
    rows = []

    # 全てのテーブルを走査し、信用残データを含むテーブルを特定
    tables = soup.find_all("table")
    target_table = None

    for table in tables:
        header_text = table.get_text()
        if "売残" in header_text and "買残" in header_text:
            target_table = table
            break

    if target_table is None:
        # 代替: id/class名で探す
        for cls_name in [
            "stock_kabuka_table",
            "stock_table",
            "data_table",
            "kabuka_table",
        ]:
            target_table = soup.find("table", class_=cls_name)
            if target_table:
                break

    if target_table is None:
        logger.debug("信用残テーブルが見つかりません")
        return rows

    # ヘッダー行を解析して列マッピングを作成
    thead = target_table.find("thead")
    header_cells = []
    if thead:
        header_cells = [th.get_text(strip=True) for th in thead.find_all("th")]
    else:
        first_row = target_table.find("tr")
        if first_row:
            header_cells = [
                cell.get_text(strip=True) for cell in first_row.find_all(["th", "td"])
            ]

    # 列インデックスの特定
    col_map = {}
    for i, h in enumerate(header_cells):
        h_lower = h.lower()
        if "日付" in h or "日" in h and i == 0:
            col_map["date"] = i
        elif "売残" in h and "short_balance" not in col_map:
            col_map["short_balance"] = i
            # 次の列が「前週比」なら売残の変化
            if i + 1 < len(header_cells) and "前週比" in header_cells[i + 1]:
                col_map["short_change"] = i + 1
        elif "買残" in h and "long_balance" not in col_map:
            col_map["long_balance"] = i
            if i + 1 < len(header_cells) and "前週比" in header_cells[i + 1]:
                col_map["long_change"] = i + 1
        elif "倍率" in h:
            col_map["margin_ratio"] = i

    # ヘッダーからの列特定に失敗した場合、デフォルトの列順序を使用
    if "date" not in col_map:
        col_map = {
            "date": 0,
            "short_balance": 1,
            "short_change": 2,
            "long_balance": 3,
            "long_change": 4,
            "margin_ratio": 5,
        }

    # データ行をパース
    tbody = target_table.find("tbody")
    data_rows = tbody.find_all("tr") if tbody else target_table.find_all("tr")[1:]

    for tr in data_rows:
        cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
        if len(cells) < max(col_map.values()) + 1:
            continue

        date_str = _parse_date(cells[col_map["date"]])
        if not date_str:
            continue

        row = {
            "date": date_str,
            "short_balance": _parse_number(cells[col_map.get("short_balance", 1)]),
            "short_change": _parse_number(cells[col_map.get("short_change", 2)]),
            "long_balance": _parse_number(cells[col_map.get("long_balance", 3)]),
            "long_change": _parse_number(cells[col_map.get("long_change", 4)]),
            "margin_ratio": _parse_number(cells[col_map.get("margin_ratio", 5)]),
        }
        rows.append(row)

    return rows


def scrape_margin_for_stock(
    code: str,
    session: requests.Session,
    max_pages: int = MARGIN_PAGES_PER_STOCK,
) -> pd.DataFrame:
    """1銘柄の信用残高データをスクレイピングする。

    Args:
        code: 銘柄コード（4桁）
        session: HTTPセッション
        max_pages: 取得するページ数

    Returns:
        信用残高のDataFrame（日付降順）
    """
    all_rows = []

    for page in range(1, max_pages + 1):
        url = f"{KABUTAN_BASE_URL}/stock/kabuka?code={code}&ashi=shinyou&page={page}"

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = session.get(url, timeout=REQUEST_TIMEOUT)
                if resp.status_code == 404:
                    logger.debug("銘柄 %s ページ %d: 404 (データなし)", code, page)
                    return _to_dataframe(all_rows, code)
                resp.raise_for_status()
                break
            except requests.RequestException as e:
                if attempt < MAX_RETRIES:
                    time.sleep(2 ** attempt)
                else:
                    logger.warning("銘柄 %s ページ %d: 取得失敗 %s", code, page, e)
                    return _to_dataframe(all_rows, code)

        soup = BeautifulSoup(resp.text, "html.parser")
        page_rows = _parse_margin_table(soup)

        if not page_rows:
            # データがなければ次のページには進まない
            break

        all_rows.extend(page_rows)
        time.sleep(REQUEST_DELAY)

    return _to_dataframe(all_rows, code)


def _to_dataframe(rows: list[dict], code: str) -> pd.DataFrame:
    """パースした行データをDataFrameに変換する。"""
    if not rows:
        return pd.DataFrame(
            columns=["date", "code", "short_balance", "short_change",
                     "long_balance", "long_change", "margin_ratio"]
        )
    df = pd.DataFrame(rows)
    df["code"] = code
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)
    return df


def scrape_all_margin_data(
    codes: list[str],
    save_intermediate: bool = True,
) -> pd.DataFrame:
    """複数銘柄の信用残高データを一括スクレイピングする。

    Args:
        codes: 銘柄コードのリスト
        save_intermediate: 銘柄ごとにCSVを保存するか

    Returns:
        全銘柄の信用残高を結合したDataFrame
    """
    os.makedirs(MARGIN_RAW_DIR, exist_ok=True)
    session = _get_session()
    all_dfs = []
    skipped = 0

    for code in tqdm(codes, desc="信用残データ取得中"):
        # 保存済みファイルがあればスキップ（差分更新対応）
        csv_path = os.path.join(MARGIN_RAW_DIR, f"{code}_margin.csv")
        if save_intermediate and os.path.exists(csv_path):
            try:
                df = pd.read_csv(csv_path, parse_dates=["date"])
                all_dfs.append(df)
                skipped += 1
                continue
            except Exception:
                pass  # ファイルが壊れている場合は再取得

        df = scrape_margin_for_stock(code, session)
        if not df.empty and save_intermediate:
            df.to_csv(csv_path, index=False)
        all_dfs.append(df)

    if skipped > 0:
        logger.info("キャッシュから読み込み: %d 銘柄", skipped)

    if not all_dfs:
        return pd.DataFrame()

    result = pd.concat(all_dfs, ignore_index=True)
    logger.info("信用残データ取得完了: %d 銘柄, %d レコード", result["code"].nunique(), len(result))
    return result

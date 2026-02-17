"""yfinanceを使用して日本株の日次株価データ（OHLCV）を取得する。

yfinanceはYahoo Financeのラッパーライブラリで、
東証銘柄は "{コード}.T" のティッカーシンボルで取得可能。
"""

import logging
import os
import time

import pandas as pd
import yfinance as yf
from tqdm import tqdm

from config import END_DATE, MAX_RETRIES, RAW_DIR, START_DATE

logger = logging.getLogger(__name__)

PRICE_RAW_DIR = os.path.join(RAW_DIR, "price")


def fetch_stock_price(
    code: str,
    start_date: str = START_DATE,
    end_date: str = END_DATE,
) -> pd.DataFrame:
    """1銘柄の日次株価データを取得する。

    Args:
        code: 銘柄コード（4桁）
        start_date: 開始日 (YYYY-MM-DD)
        end_date: 終了日 (YYYY-MM-DD)

    Returns:
        日次OHLCVのDataFrame
    """
    ticker = f"{code}.T"

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            df = yf.download(
                ticker,
                start=start_date,
                end=end_date,
                progress=False,
                auto_adjust=True,
            )
            if df.empty:
                logger.warning("銘柄 %s: データなし", code)
                return pd.DataFrame()

            # MultiIndex対応（yfinanceのバージョンによる）
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)

            df = df.reset_index()
            df["code"] = code

            # カラム名を英語小文字に統一
            df = df.rename(columns={
                "Date": "date",
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume",
            })

            # 必要なカラムだけ残す
            keep_cols = ["date", "code", "open", "high", "low", "close", "volume"]
            df = df[[c for c in keep_cols if c in df.columns]]
            df["date"] = pd.to_datetime(df["date"])

            return df

        except Exception as e:
            if attempt < MAX_RETRIES:
                logger.debug("銘柄 %s 試行 %d 失敗: %s", code, attempt, e)
                time.sleep(2 ** attempt)
            else:
                logger.warning("銘柄 %s: 株価取得失敗 %s", code, e)
                return pd.DataFrame()

    return pd.DataFrame()


def fetch_all_stock_prices(
    codes: list[str],
    start_date: str = START_DATE,
    end_date: str = END_DATE,
    save_intermediate: bool = True,
) -> pd.DataFrame:
    """複数銘柄の株価データを一括取得する。

    Args:
        codes: 銘柄コードのリスト
        start_date: 開始日
        end_date: 終了日
        save_intermediate: 銘柄ごとにCSVを保存するか

    Returns:
        全銘柄の株価を結合したDataFrame
    """
    os.makedirs(PRICE_RAW_DIR, exist_ok=True)
    all_dfs = []
    skipped = 0

    for code in tqdm(codes, desc="株価データ取得中"):
        csv_path = os.path.join(PRICE_RAW_DIR, f"{code}_price.csv")

        # キャッシュがあればスキップ
        if save_intermediate and os.path.exists(csv_path):
            try:
                df = pd.read_csv(csv_path, parse_dates=["date"])
                all_dfs.append(df)
                skipped += 1
                continue
            except Exception:
                pass

        df = fetch_stock_price(code, start_date, end_date)
        if not df.empty and save_intermediate:
            df.to_csv(csv_path, index=False)
        all_dfs.append(df)

    if skipped > 0:
        logger.info("キャッシュから読み込み: %d 銘柄", skipped)

    if not all_dfs:
        return pd.DataFrame()

    result = pd.concat(all_dfs, ignore_index=True)
    logger.info(
        "株価データ取得完了: %d 銘柄, %d レコード",
        result["code"].nunique(),
        len(result),
    )
    return result

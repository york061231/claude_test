"""JPX（日本取引所グループ）から東証上場銘柄一覧を取得し、
プライム・スタンダード市場の銘柄コードを返す。"""

import io
import logging
import time

import pandas as pd
import requests
import yfinance as yf

from config import (
    JPX_STOCK_LIST_URL,
    MAX_RETRIES,
    NUM_STOCKS,
    REQUEST_TIMEOUT,
    TARGET_MARKETS,
    USER_AGENT,
)

logger = logging.getLogger(__name__)


def fetch_jpx_stock_list() -> pd.DataFrame:
    """JPXの東証上場銘柄一覧ExcelをダウンロードしてDataFrameとして返す。

    Returns:
        全銘柄のDataFrame（コード、銘柄名、市場区分等を含む）
    """
    headers = {"User-Agent": USER_AGENT}

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = requests.get(
                JPX_STOCK_LIST_URL, headers=headers, timeout=REQUEST_TIMEOUT
            )
            resp.raise_for_status()
            df = pd.read_excel(io.BytesIO(resp.content))
            logger.info("JPX銘柄一覧を取得しました: %d 銘柄", len(df))
            return df
        except Exception as e:
            logger.warning("JPX銘柄一覧取得 試行%d/%d 失敗: %s", attempt, MAX_RETRIES, e)
            if attempt < MAX_RETRIES:
                time.sleep(2 ** attempt)
    raise RuntimeError("JPX銘柄一覧の取得に失敗しました")


def filter_stocks(df: pd.DataFrame) -> pd.DataFrame:
    """プライム・スタンダード市場の内国株式のみにフィルタリングする。

    低流動性銘柄（ETF/REIT等）を除外し、グロース市場も除外する。
    """
    # 市場区分でフィルタ（プライム・スタンダードの内国株式のみ）
    df = df[df["市場・商品区分"].isin(TARGET_MARKETS)].copy()
    logger.info("市場フィルタ後: %d 銘柄", len(df))

    # コードが4桁の整数である銘柄のみ（ETF等の5桁コードを除外）
    df["コード"] = df["コード"].astype(str)
    df = df[df["コード"].str.match(r"^\d{4}$")]
    logger.info("コードフィルタ後: %d 銘柄", len(df))

    return df.reset_index(drop=True)


def select_top_stocks_by_volume(
    codes: list[str], num_stocks: int = NUM_STOCKS
) -> list[str]:
    """yfinanceで直近の平均出来高を取得し、出来高上位銘柄を選択する。

    Args:
        codes: 銘柄コードのリスト
        num_stocks: 選択する銘柄数

    Returns:
        出来高上位の銘柄コードリスト
    """
    logger.info("出来高データを取得中... (対象: %d 銘柄)", len(codes))

    # yfinanceのティッカー形式（東証は .T サフィックス）
    tickers = [f"{c}.T" for c in codes]

    # バッチで取得（yfinanceは複数ティッカーに対応）
    batch_size = 50
    volume_data = {}

    for i in range(0, len(tickers), batch_size):
        batch = tickers[i : i + batch_size]
        ticker_str = " ".join(batch)
        try:
            data = yf.download(
                ticker_str, period="1mo", progress=False, threads=True
            )
            if "Volume" in data.columns:
                if isinstance(data.columns, pd.MultiIndex):
                    # 複数銘柄の場合はMultiIndex
                    for ticker in batch:
                        if ticker in data["Volume"].columns:
                            avg_vol = data["Volume"][ticker].mean()
                            if pd.notna(avg_vol) and avg_vol > 0:
                                code = ticker.replace(".T", "")
                                volume_data[code] = avg_vol
                else:
                    # 単一銘柄の場合
                    avg_vol = data["Volume"].mean()
                    if pd.notna(avg_vol) and avg_vol > 0:
                        code = batch[0].replace(".T", "")
                        volume_data[code] = avg_vol
        except Exception as e:
            logger.warning("出来高取得エラー (batch %d): %s", i, e)
            continue

        logger.info("  %d / %d 銘柄の出来高を取得", min(i + batch_size, len(tickers)), len(tickers))

    # 出来高でソートして上位を返す
    sorted_codes = sorted(volume_data.keys(), key=lambda c: volume_data[c], reverse=True)
    selected = sorted_codes[:num_stocks]
    logger.info("出来高上位 %d 銘柄を選択しました", len(selected))
    return selected


def get_target_stock_codes(num_stocks: int = NUM_STOCKS) -> list[str]:
    """メインのエントリーポイント: 対象銘柄コードリストを返す。

    1. JPXから全上場銘柄を取得
    2. プライム・スタンダード市場でフィルタ
    3. 出来高上位 num_stocks 銘柄を選択

    Returns:
        対象銘柄コードのリスト
    """
    df = fetch_jpx_stock_list()
    df = filter_stocks(df)
    all_codes = df["コード"].tolist()

    if len(all_codes) <= num_stocks:
        logger.info("フィルタ後の銘柄数が目標以下のため、全銘柄を使用: %d", len(all_codes))
        return all_codes

    return select_top_stocks_by_volume(all_codes, num_stocks)

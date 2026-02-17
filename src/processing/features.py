"""信用残高データと株価データを結合し、特徴量と目的変数を生成する。

特徴量一覧:
  - short_balance: 信用売残（週次 → 日次前方埋め）
  - long_balance: 信用買残（週次 → 日次前方埋め）
  - margin_ratio: 信用倍率（= long_balance / short_balance）
  - short_change: 売残の前週比（絶対値）
  - long_change: 買残の前週比（絶対値）
  - short_change_rate: 売残の前週比率（%）
  - long_change_rate: 買残の前週比率（%）
  - margin_ratio_change: 信用倍率の前週比変化
  - margin_ratio_change_rate: 信用倍率の前週比率（%）

目的変数:
  - next_day_return: 翌営業日リターン = close[t+1] / close[t] - 1
"""

import logging
import os

import numpy as np
import pandas as pd

from config import PROCESSED_DIR

logger = logging.getLogger(__name__)


def merge_margin_and_price(
    margin_df: pd.DataFrame,
    price_df: pd.DataFrame,
) -> pd.DataFrame:
    """信用残高（週次）と株価（日次）を結合する。

    信用残データは週次のため、日次の株価データに対して
    前方埋め（forward-fill）を行い、日次粒度に揃える。

    Args:
        margin_df: 信用残高DataFrame（columns: date, code, short_balance, ...）
        price_df: 株価DataFrame（columns: date, code, close, volume, ...）

    Returns:
        結合されたDataFrame（日次粒度）
    """
    # date型を揃える
    margin_df = margin_df.copy()
    price_df = price_df.copy()
    margin_df["date"] = pd.to_datetime(margin_df["date"])
    price_df["date"] = pd.to_datetime(price_df["date"])

    # 信用残データの列名を整理
    margin_cols = ["date", "code", "short_balance", "long_balance",
                   "short_change", "long_change", "margin_ratio"]
    margin_df = margin_df[[c for c in margin_cols if c in margin_df.columns]]

    merged_dfs = []
    codes = sorted(set(margin_df["code"].unique()) & set(price_df["code"].unique()))
    logger.info("結合対象: %d 銘柄", len(codes))

    for code in codes:
        m = margin_df[margin_df["code"] == code].sort_values("date")
        p = price_df[price_df["code"] == code].sort_values("date")

        if m.empty or p.empty:
            continue

        # 株価の日付ベースで信用残をマージ（asof merge で前方埋め）
        m = m.set_index("date").drop(columns=["code"])
        p = p.set_index("date")

        # 日次の株価インデックスに信用残をリインデックスして前方埋め
        combined = p.join(m, how="left")
        margin_fill_cols = [c for c in m.columns if c in combined.columns]
        combined[margin_fill_cols] = combined[margin_fill_cols].ffill()

        combined = combined.reset_index()
        merged_dfs.append(combined)

    if not merged_dfs:
        logger.warning("結合できた銘柄がありません")
        return pd.DataFrame()

    result = pd.concat(merged_dfs, ignore_index=True)
    logger.info("結合完了: %d 銘柄, %d レコード", result["code"].nunique(), len(result))
    return result


def create_features(df: pd.DataFrame) -> pd.DataFrame:
    """特徴量と目的変数を生成する。

    Args:
        df: merge_margin_and_price()の出力DataFrame

    Returns:
        特徴量・目的変数を追加したDataFrame
    """
    df = df.copy()

    # --- 信用倍率（買残/売残）の再計算 ---
    # スクレイピングデータにmargin_ratioがNaNの場合に補完
    mask = df["margin_ratio"].isna() & df["short_balance"].notna() & (df["short_balance"] > 0)
    df.loc[mask, "margin_ratio"] = df.loc[mask, "long_balance"] / df.loc[mask, "short_balance"]

    # --- 前週比変化率 ---
    # 銘柄ごとに計算
    feature_dfs = []
    for code, group in df.groupby("code"):
        g = group.sort_values("date").copy()

        # 売残の前週比率
        g["short_change_rate"] = (
            g["short_balance"].pct_change(periods=5).replace([np.inf, -np.inf], np.nan)
        )
        # 買残の前週比率
        g["long_change_rate"] = (
            g["long_balance"].pct_change(periods=5).replace([np.inf, -np.inf], np.nan)
        )
        # 信用倍率の変化（5営業日前との差）
        g["margin_ratio_change"] = g["margin_ratio"].diff(periods=5)
        g["margin_ratio_change_rate"] = (
            g["margin_ratio"].pct_change(periods=5).replace([np.inf, -np.inf], np.nan)
        )

        # --- 目的変数: 翌営業日リターン ---
        g["next_day_return"] = g["close"].shift(-1) / g["close"] - 1

        feature_dfs.append(g)

    result = pd.concat(feature_dfs, ignore_index=True)

    # 信用残データが埋まっていない行を除外
    result = result.dropna(subset=["short_balance", "long_balance"])

    logger.info(
        "特徴量生成完了: %d 銘柄, %d レコード",
        result["code"].nunique(),
        len(result),
    )
    return result


def get_feature_columns() -> list[str]:
    """モデルに入力する特徴量カラム名のリストを返す。"""
    return [
        "short_balance",
        "long_balance",
        "margin_ratio",
        "short_change",
        "long_change",
        "short_change_rate",
        "long_change_rate",
        "margin_ratio_change",
        "margin_ratio_change_rate",
    ]


def build_dataset(
    margin_df: pd.DataFrame,
    price_df: pd.DataFrame,
    save: bool = True,
) -> pd.DataFrame:
    """完全なデータセットを構築する（結合 → 特徴量生成）。

    Args:
        margin_df: 信用残高DataFrame
        price_df: 株価DataFrame
        save: processed/ にCSV保存するか

    Returns:
        特徴量・目的変数を含むDataFrame
    """
    merged = merge_margin_and_price(margin_df, price_df)
    if merged.empty:
        return merged

    dataset = create_features(merged)

    if save and not dataset.empty:
        os.makedirs(PROCESSED_DIR, exist_ok=True)
        path = os.path.join(PROCESSED_DIR, "dataset.csv")
        dataset.to_csv(path, index=False)
        logger.info("データセット保存: %s (%d行)", path, len(dataset))

    return dataset

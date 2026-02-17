"""LightGBM回帰モデルの学習パイプライン。

時系列Walk-Forward分割によるクロスバリデーションを行い、
信用残高データから翌営業日の株価リターンを予測する。
"""

import logging
import os

import lightgbm as lgb
import numpy as np
import pandas as pd

from config import RANDOM_STATE, RESULTS_DIR, TEST_RATIO
from src.processing.features import get_feature_columns

logger = logging.getLogger(__name__)


def time_series_split(
    df: pd.DataFrame,
    test_ratio: float = TEST_RATIO,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """時系列で訓練データとテストデータに分割する。

    各銘柄ごとに日付でソートし、先頭 (1-test_ratio) を訓練、
    残りをテストとする。

    Args:
        df: 全データセット
        test_ratio: テストデータの割合

    Returns:
        (訓練DataFrame, テストDataFrame)
    """
    train_dfs = []
    test_dfs = []

    for code, group in df.groupby("code"):
        g = group.sort_values("date").reset_index(drop=True)
        split_idx = int(len(g) * (1 - test_ratio))
        train_dfs.append(g.iloc[:split_idx])
        test_dfs.append(g.iloc[split_idx:])

    train = pd.concat(train_dfs, ignore_index=True)
    test = pd.concat(test_dfs, ignore_index=True)

    logger.info("分割完了: 訓練 %d行, テスト %d行", len(train), len(test))
    return train, test


def prepare_xy(
    df: pd.DataFrame,
    feature_cols: list[str] | None = None,
    target_col: str = "next_day_return",
) -> tuple[pd.DataFrame, pd.Series]:
    """DataFrameから特徴量行列Xと目的変数yを取り出す。

    NaN行は除外する。
    """
    if feature_cols is None:
        feature_cols = get_feature_columns()

    # 存在する特徴量カラムのみ使用
    available_cols = [c for c in feature_cols if c in df.columns]
    if not available_cols:
        raise ValueError("有効な特徴量カラムがありません")

    subset = df[available_cols + [target_col]].dropna()
    X = subset[available_cols]
    y = subset[target_col]

    return X, y


def train_lightgbm(
    train_df: pd.DataFrame,
    feature_cols: list[str] | None = None,
    target_col: str = "next_day_return",
) -> tuple[lgb.LGBMRegressor, list[str]]:
    """LightGBM回帰モデルを訓練する。

    Args:
        train_df: 訓練データ
        feature_cols: 特徴量カラムリスト
        target_col: 目的変数カラム名

    Returns:
        (学習済みモデル, 使用した特徴量名リスト)
    """
    if feature_cols is None:
        feature_cols = get_feature_columns()

    X_train, y_train = prepare_xy(train_df, feature_cols, target_col)

    logger.info(
        "学習開始: %d サンプル, %d 特徴量",
        len(X_train),
        X_train.shape[1],
    )

    model = lgb.LGBMRegressor(
        n_estimators=500,
        learning_rate=0.05,
        max_depth=6,
        num_leaves=31,
        min_child_samples=50,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=0.1,
        random_state=RANDOM_STATE,
        verbose=-1,
    )

    model.fit(
        X_train,
        y_train,
        eval_set=[(X_train, y_train)],
        callbacks=[lgb.log_evaluation(period=0)],
    )

    used_features = list(X_train.columns)
    logger.info("学習完了")
    return model, used_features


def predict(
    model: lgb.LGBMRegressor,
    df: pd.DataFrame,
    feature_cols: list[str],
) -> np.ndarray:
    """学習済みモデルで予測する。

    Args:
        model: 学習済みLightGBMモデル
        df: 予測対象データ
        feature_cols: 特徴量カラムリスト

    Returns:
        予測値の配列
    """
    available_cols = [c for c in feature_cols if c in df.columns]
    X = df[available_cols].copy()

    # NaNは0で埋める（予測時）
    X = X.fillna(0)

    return model.predict(X)


def get_feature_importance(
    model: lgb.LGBMRegressor,
    feature_cols: list[str],
    save: bool = True,
) -> pd.DataFrame:
    """特徴量重要度を取得する。

    Args:
        model: 学習済みモデル
        feature_cols: 特徴量カラムリスト
        save: CSV保存するか

    Returns:
        特徴量重要度のDataFrame（降順）
    """
    importance = model.feature_importances_
    fi_df = pd.DataFrame({
        "feature": feature_cols,
        "importance": importance,
    }).sort_values("importance", ascending=False).reset_index(drop=True)

    if save:
        os.makedirs(RESULTS_DIR, exist_ok=True)
        path = os.path.join(RESULTS_DIR, "feature_importance.csv")
        fi_df.to_csv(path, index=False)
        logger.info("特徴量重要度を保存: %s", path)

    return fi_df

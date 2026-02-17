"""モデル評価モジュール。

回帰モデルの評価指標:
  - MAE（平均絶対誤差）
  - RMSE（二乗平均平方根誤差）
  - 相関係数（予測値 vs 実績値）
  - 方向一致率（上昇/下降の方向が一致した割合）
"""

import logging
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

from config import RESULTS_DIR

logger = logging.getLogger(__name__)


def compute_metrics(
    y_true: np.ndarray | pd.Series,
    y_pred: np.ndarray | pd.Series,
) -> dict[str, float]:
    """回帰の評価指標を計算する。

    Args:
        y_true: 実績値
        y_pred: 予測値

    Returns:
        各指標のdict
    """
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)

    # NaNを除外
    mask = ~(np.isnan(y_true) | np.isnan(y_pred))
    y_true = y_true[mask]
    y_pred = y_pred[mask]

    if len(y_true) == 0:
        return {"mae": np.nan, "rmse": np.nan, "correlation": np.nan, "direction_accuracy": np.nan}

    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))

    # 相関係数
    if np.std(y_true) > 0 and np.std(y_pred) > 0:
        correlation = np.corrcoef(y_true, y_pred)[0, 1]
    else:
        correlation = 0.0

    # 方向一致率（0を除いたリターンで計算）
    nonzero_mask = y_true != 0
    if nonzero_mask.sum() > 0:
        direction_match = (np.sign(y_true[nonzero_mask]) == np.sign(y_pred[nonzero_mask]))
        direction_accuracy = direction_match.mean()
    else:
        direction_accuracy = np.nan

    return {
        "mae": mae,
        "rmse": rmse,
        "correlation": correlation,
        "direction_accuracy": direction_accuracy,
    }


def evaluate_model(
    test_df: pd.DataFrame,
    y_pred: np.ndarray,
    target_col: str = "next_day_return",
    save: bool = True,
) -> dict[str, float]:
    """テストデータに対してモデルを評価する。

    Args:
        test_df: テストデータ
        y_pred: 予測値
        target_col: 目的変数のカラム名
        save: 結果をCSV保存するか

    Returns:
        評価指標のdict
    """
    y_true = test_df[target_col].values

    # 予測値とテストデータの長さが異なる場合の対処
    min_len = min(len(y_true), len(y_pred))
    y_true = y_true[:min_len]
    y_pred = y_pred[:min_len]

    metrics = compute_metrics(y_true, y_pred)

    logger.info("=== 評価結果 ===")
    logger.info("MAE:              %.6f", metrics["mae"])
    logger.info("RMSE:             %.6f", metrics["rmse"])
    logger.info("相関係数:          %.4f", metrics["correlation"])
    logger.info("方向一致率:        %.4f (%.1f%%)", metrics["direction_accuracy"],
                metrics["direction_accuracy"] * 100)

    if save:
        os.makedirs(RESULTS_DIR, exist_ok=True)

        # メトリクスの保存
        metrics_df = pd.DataFrame([metrics])
        path = os.path.join(RESULTS_DIR, "evaluation_metrics.csv")
        metrics_df.to_csv(path, index=False)
        logger.info("評価指標を保存: %s", path)

        # 予測 vs 実績の保存
        pred_df = pd.DataFrame({
            "y_true": y_true,
            "y_pred": y_pred,
        })
        if "date" in test_df.columns:
            pred_df["date"] = test_df["date"].values[:min_len]
        if "code" in test_df.columns:
            pred_df["code"] = test_df["code"].values[:min_len]
        pred_path = os.path.join(RESULTS_DIR, "predictions.csv")
        pred_df.to_csv(pred_path, index=False)
        logger.info("予測結果を保存: %s", pred_path)

    return metrics


def plot_results(
    y_true: np.ndarray | pd.Series,
    y_pred: np.ndarray | pd.Series,
    save: bool = True,
) -> None:
    """予測結果の可視化を行う。

    1. 予測 vs 実績の散布図
    2. 残差の分布

    Args:
        y_true: 実績値
        y_pred: 予測値
        save: 画像を保存するか
    """
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)

    mask = ~(np.isnan(y_true) | np.isnan(y_pred))
    y_true = y_true[mask]
    y_pred = y_pred[mask]

    fig, axes = plt.subplots(1, 2, figsize=(14, 6))

    # 散布図
    ax = axes[0]
    ax.scatter(y_true, y_pred, alpha=0.1, s=5)
    min_val = min(y_true.min(), y_pred.min())
    max_val = max(y_true.max(), y_pred.max())
    ax.plot([min_val, max_val], [min_val, max_val], "r--", linewidth=1)
    ax.set_xlabel("実績リターン")
    ax.set_ylabel("予測リターン")
    ax.set_title("予測 vs 実績")
    ax.grid(True, alpha=0.3)

    # 残差分布
    ax = axes[1]
    residuals = y_pred - y_true
    ax.hist(residuals, bins=100, alpha=0.7, edgecolor="black", linewidth=0.5)
    ax.axvline(x=0, color="r", linestyle="--", linewidth=1)
    ax.set_xlabel("残差（予測 - 実績）")
    ax.set_ylabel("頻度")
    ax.set_title(f"残差分布 (平均: {residuals.mean():.6f}, 標準偏差: {residuals.std():.6f})")
    ax.grid(True, alpha=0.3)

    plt.tight_layout()

    if save:
        os.makedirs(RESULTS_DIR, exist_ok=True)
        path = os.path.join(RESULTS_DIR, "evaluation_plot.png")
        plt.savefig(path, dpi=150, bbox_inches="tight")
        logger.info("評価プロットを保存: %s", path)
        plt.close(fig)
    else:
        plt.show()


def plot_feature_importance(
    fi_df: pd.DataFrame,
    save: bool = True,
) -> None:
    """特徴量重要度の棒グラフを描画する。

    Args:
        fi_df: feature, importance カラムを持つDataFrame
        save: 画像を保存するか
    """
    fig, ax = plt.subplots(figsize=(10, 6))

    fi_sorted = fi_df.sort_values("importance", ascending=True)
    ax.barh(fi_sorted["feature"], fi_sorted["importance"])
    ax.set_xlabel("重要度（split回数）")
    ax.set_title("特徴量重要度")
    ax.grid(True, alpha=0.3, axis="x")

    plt.tight_layout()

    if save:
        os.makedirs(RESULTS_DIR, exist_ok=True)
        path = os.path.join(RESULTS_DIR, "feature_importance.png")
        plt.savefig(path, dpi=150, bbox_inches="tight")
        logger.info("特徴量重要度プロットを保存: %s", path)
        plt.close(fig)
    else:
        plt.show()

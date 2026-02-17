"""信用残高データによる翌日株価リターン予測パイプライン

実行方法:
  python main.py                    # 全パイプライン実行
  python main.py --step scrape      # スクレイピングのみ
  python main.py --step features    # 特徴量生成のみ（要: スクレイピング済みデータ）
  python main.py --step train       # 学習・評価のみ（要: dataset.csv）
  python main.py --num-stocks 50    # 銘柄数を指定

Google Colabでの実行:
  !git clone https://github.com/york061231/claude_test.git
  %cd claude_test
  !pip install -r requirements.txt
  !python main.py --num-stocks 50
"""

import argparse
import logging
import os
import sys

import pandas as pd

from config import NUM_STOCKS, PROCESSED_DIR, RAW_DIR, RESULTS_DIR

# ロギング設定
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def step_scrape(num_stocks: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Step 1: データ収集（銘柄一覧、信用残、株価）"""
    from src.scraper.stock_list import get_target_stock_codes
    from src.scraper.margin_data import scrape_all_margin_data
    from src.scraper.stock_price import fetch_all_stock_prices

    logger.info("=" * 60)
    logger.info("Step 1: データ収集")
    logger.info("=" * 60)

    # 1-1: 対象銘柄の選定
    logger.info("--- 1-1: 対象銘柄の選定 ---")
    codes = get_target_stock_codes(num_stocks)
    logger.info("選定銘柄数: %d", len(codes))

    # 銘柄リストを保存
    os.makedirs(RAW_DIR, exist_ok=True)
    codes_path = os.path.join(RAW_DIR, "target_codes.csv")
    pd.DataFrame({"code": codes}).to_csv(codes_path, index=False)
    logger.info("銘柄リスト保存: %s", codes_path)

    # 1-2: 信用残高データの取得
    logger.info("--- 1-2: 信用残高データの取得 ---")
    margin_df = scrape_all_margin_data(codes)
    if not margin_df.empty:
        margin_path = os.path.join(RAW_DIR, "margin_all.csv")
        margin_df.to_csv(margin_path, index=False)
        logger.info("信用残データ保存: %s (%d行)", margin_path, len(margin_df))

    # 1-3: 株価データの取得
    logger.info("--- 1-3: 株価データの取得 ---")
    price_df = fetch_all_stock_prices(codes)
    if not price_df.empty:
        price_path = os.path.join(RAW_DIR, "price_all.csv")
        price_df.to_csv(price_path, index=False)
        logger.info("株価データ保存: %s (%d行)", price_path, len(price_df))

    return margin_df, price_df


def step_features(
    margin_df: pd.DataFrame | None = None,
    price_df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Step 2: 特徴量生成"""
    from src.processing.features import build_dataset

    logger.info("=" * 60)
    logger.info("Step 2: 特徴量生成")
    logger.info("=" * 60)

    # 保存済みデータの読み込み
    if margin_df is None:
        margin_path = os.path.join(RAW_DIR, "margin_all.csv")
        if not os.path.exists(margin_path):
            logger.error("信用残データが見つかりません: %s", margin_path)
            logger.error("先に --step scrape を実行してください")
            sys.exit(1)
        margin_df = pd.read_csv(margin_path, parse_dates=["date"])

    if price_df is None:
        price_path = os.path.join(RAW_DIR, "price_all.csv")
        if not os.path.exists(price_path):
            logger.error("株価データが見つかりません: %s", price_path)
            logger.error("先に --step scrape を実行してください")
            sys.exit(1)
        price_df = pd.read_csv(price_path, parse_dates=["date"])

    dataset = build_dataset(margin_df, price_df)

    if dataset.empty:
        logger.error("データセットが空です。データ収集を確認してください。")
        sys.exit(1)

    logger.info("データセット: %d銘柄, %d行, %dカラム",
                dataset["code"].nunique(), len(dataset), dataset.shape[1])

    return dataset


def step_train(dataset: pd.DataFrame | None = None) -> None:
    """Step 3: モデル学習・評価"""
    from src.model.train import (
        get_feature_importance,
        predict,
        prepare_xy,
        time_series_split,
        train_lightgbm,
    )
    from src.model.evaluate import (
        evaluate_model,
        plot_feature_importance,
        plot_results,
    )

    logger.info("=" * 60)
    logger.info("Step 3: モデル学習・評価")
    logger.info("=" * 60)

    # 保存済みデータセットの読み込み
    if dataset is None:
        dataset_path = os.path.join(PROCESSED_DIR, "dataset.csv")
        if not os.path.exists(dataset_path):
            logger.error("データセットが見つかりません: %s", dataset_path)
            logger.error("先に --step features を実行してください")
            sys.exit(1)
        dataset = pd.read_csv(dataset_path, parse_dates=["date"])

    # 3-1: 時系列分割
    logger.info("--- 3-1: 時系列分割 ---")
    train_df, test_df = time_series_split(dataset)

    # 3-2: モデル学習
    logger.info("--- 3-2: モデル学習 (LightGBM) ---")
    model, feature_cols = train_lightgbm(train_df)

    # 3-3: テストデータで予測
    logger.info("--- 3-3: テストデータで予測 ---")
    # テストデータからNaN行を除外して予測
    _, y_test = prepare_xy(test_df, feature_cols)
    test_clean = test_df.dropna(
        subset=feature_cols + ["next_day_return"]
    ).reset_index(drop=True)
    y_pred = predict(model, test_clean, feature_cols)

    # 3-4: 評価
    logger.info("--- 3-4: 評価 ---")
    metrics = evaluate_model(test_clean, y_pred)

    # 3-5: 可視化
    logger.info("--- 3-5: 可視化 ---")
    y_true = test_clean["next_day_return"].values[:len(y_pred)]
    plot_results(y_true, y_pred)

    # 3-6: 特徴量重要度
    fi_df = get_feature_importance(model, feature_cols)
    plot_feature_importance(fi_df)

    logger.info("=" * 60)
    logger.info("パイプライン完了")
    logger.info("=" * 60)
    logger.info("結果ディレクトリ: %s", RESULTS_DIR)
    logger.info("  - evaluation_metrics.csv : 評価指標")
    logger.info("  - predictions.csv        : 予測結果")
    logger.info("  - feature_importance.csv  : 特徴量重要度")
    logger.info("  - evaluation_plot.png     : 評価プロット")
    logger.info("  - feature_importance.png  : 特徴量重要度プロット")

    return metrics


def main():
    parser = argparse.ArgumentParser(
        description="信用残高データによる翌日株価リターン予測パイプライン"
    )
    parser.add_argument(
        "--step",
        choices=["scrape", "features", "train", "all"],
        default="all",
        help="実行するステップ (default: all)",
    )
    parser.add_argument(
        "--num-stocks",
        type=int,
        default=NUM_STOCKS,
        help=f"対象銘柄数 (default: {NUM_STOCKS})",
    )
    args = parser.parse_args()

    logger.info("信用残高データによる翌日株価リターン予測")
    logger.info("対象銘柄数: %d", args.num_stocks)
    logger.info("ステップ: %s", args.step)

    if args.step == "scrape":
        step_scrape(args.num_stocks)

    elif args.step == "features":
        step_features()

    elif args.step == "train":
        step_train()

    elif args.step == "all":
        margin_df, price_df = step_scrape(args.num_stocks)
        dataset = step_features(margin_df, price_df)
        step_train(dataset)


if __name__ == "__main__":
    main()

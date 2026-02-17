"""プロジェクト全体の設定定数"""

import os
from datetime import datetime

# ディレクトリ設定
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
RAW_DIR = os.path.join(DATA_DIR, "raw")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")
RESULTS_DIR = os.path.join(DATA_DIR, "results")

# スクレイピング設定
REQUEST_DELAY = 1.5  # リクエスト間隔（秒）
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
MAX_RETRIES = 3
REQUEST_TIMEOUT = 30

# 銘柄選定設定
TARGET_MARKETS = ["プライム（内国株式）", "スタンダード（内国株式）"]
NUM_STOCKS = 300

# データ期間
START_DATE = "2023-01-01"
END_DATE = datetime.now().strftime("%Y-%m-%d")

# JPX 東証上場銘柄一覧 URL
JPX_STOCK_LIST_URL = (
    "https://www.jpx.co.jp/markets/statistics-equities/"
    "misc/tvdivq0000001vg2-att/data_j.xls"
)

# kabutan.jp 信用残スクレイピング設定
KABUTAN_BASE_URL = "https://kabutan.jp"
MARGIN_PAGES_PER_STOCK = 6  # 1ページ約25週 × 6 ≒ 約3年分

# モデル設定
TEST_RATIO = 0.2
RANDOM_STATE = 42

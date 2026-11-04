from argparse import Namespace
from pathlib import Path


def load_config():
    args = Namespace(config=Path("config/demo.json"), offline=True)
    path = str(args.config)
    metadata = {"theme": "dark", "retries": 3}
    print(path, metadata)
    return path


load_config()

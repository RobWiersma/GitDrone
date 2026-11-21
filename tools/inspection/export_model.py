"""
Exports the Inspector's detector: YOLO-World v2 with GitDrone's inspection vocabulary baked in, as ONNX for
ONNX Runtime Web. Run on your own machine (needs ~3 GB of Python packages):

    python -m venv .venv
    .venv\\Scripts\\pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    .venv\\Scripts\\pip install ultralytics onnx onnxslim git+https://github.com/ultralytics/CLIP.git
    .venv\\Scripts\\python tools/inspection/export_model.py --size s   # small, ~50 MB, fastest
    .venv\\Scripts\\python tools/inspection/export_model.py --size m   # medium, ~112 MB
    .venv\\Scripts\\python tools/inspection/export_model.py            # large (default), ~186 MB: fewest look-alike mix-ups
    .venv\\Scripts\\python tools/inspection/export_model.py --size m --keep-default   # just inspection-m.onnx, to compare

On 4K DJI O4 footage all three scan at about 8 frames a second on an RTX 3060 Ti (decoding 4K is the bottleneck),
so the large model costs nothing there; on 1080p footage the smaller ones are quicker.

It writes drone-logger/public/models/inspection-<size>.onnx and copies it to inspection-v1.onnx, the one the /inspector
page loads (unless --keep-default), which `ng serve` serves. That folder is
git-ignored: the model is big, so it isn't committed or deployed. Elsewhere, pick the .onnx on the page itself.

The classes and their prompts live in drone-logger/src/app/inspect/vocabulary.json, shared with the page:
edit them there, then re-export.
The weights are Ultralytics' (AGPL-3.0), which sits fine with this GPL-3.0 repository.
"""

import argparse
import json
import os
import shutil
from pathlib import Path

from ultralytics import YOLOWorld

VOCABULARY = Path(__file__).resolve().parents[2] / "drone-logger" / "src" / "app" / "inspect" / "vocabulary.json"


def prompts() -> list[str]:
    """Every class's prompts, in order: the model gets one output per prompt, which the page folds back into classes."""
    classes = json.loads(VOCABULARY.read_text(encoding="utf-8"))["classes"]
    return [p for c in classes for p in c["prompts"]]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--size", choices=["s", "m", "l"], default="l", help="model size (default l)")
    parser.add_argument("--keep-default", action="store_true", help="don't replace inspection-v1.onnx, the page's model")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    work = Path(__file__).resolve().parent / "build"
    work.mkdir(exist_ok=True)
    os.chdir(work)  # CLIP's text-encoder weights download into ./weights, so keep them here (git-ignored)

    model = YOLOWorld(str(work / f"yolov8{args.size}-worldv2.pt"))
    model.set_classes(prompts())
    onnx = Path(model.export(format="onnx", imgsz=640, opset=17, simplify=True, dynamic=False))

    models = root / "drone-logger" / "public" / "models"
    models.mkdir(parents=True, exist_ok=True)
    targets = [models / f"inspection-{args.size}.onnx"] + ([] if args.keep_default else [models / "inspection-v1.onnx"])
    for target in targets:
        shutil.copyfile(onnx, target)
        print(f"Wrote {target} ({target.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

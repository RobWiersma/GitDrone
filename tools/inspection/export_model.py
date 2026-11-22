"""
Exports the Inspector's detector: YOLO-World v2 as ONNX for ONNX Runtime Web, taking what to look for as an input, so
the page can look for anything the pilot types in without a new model. Run on your own machine (needs ~3 GB of Python
packages):

    py -m venv tools/inspection/build/.venv
    tools\\inspection\\build\\.venv\\Scripts\\pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    tools\\inspection\\build\\.venv\\Scripts\\pip install ultralytics onnx onnxslim onnxruntime git+https://github.com/ultralytics/CLIP.git
    tools\\inspection\\build\\.venv\\Scripts\\python tools/inspection/export_model.py --size s   # small, ~50 MB, fastest
    tools\\inspection\\build\\.venv\\Scripts\\python tools/inspection/export_model.py --size m   # medium, ~112 MB
    tools\\inspection\\build\\.venv\\Scripts\\python tools/inspection/export_model.py            # large (default), ~186 MB: fewest look-alike mix-ups
    tools\\inspection\\build\\.venv\\Scripts\\python tools/inspection/export_model.py --size m --keep-default   # just inspection-m-v2.onnx, to compare

The model's inputs are the picture (`images`, 1x3x640x640) and what to look for (`txt_feats`, 1xSLOTSx512): CLIP
ViT-B/32 text embeddings, one per prompt, scaled to length 1, with unused slots filled by repeating the first prompt
(YOLO-World takes the strongest match over its prompts in places, so a repeat changes nothing, where an empty slot
would). Its output is 1x(4+SLOTS)x8400 as before, the page reading only the slots it filled.

It writes:
- drone-logger/public/models/inspection-<size>-v2.onnx, and a copy as inspection-v2.onnx, the one the /inspector page
  loads (unless --keep-default), which `ng serve` serves. That folder is git-ignored: the model is big, so it isn't
  committed or deployed. The live site downloads it from Hugging Face (HOSTED_MODEL in inspect-model.ts): to publish a
  new one, upload it there under a new name and point HOSTED_MODEL at it.
- drone-logger/src/app/inspect/prompt-embeddings.json: the built-in prompts' embeddings (vocabulary.json's), worked out
  by the same CLIP the model was trained with, so the page only needs the CLIP text model for prompts typed in. Commit
  it whenever vocabulary.json changes (re-run with --embeddings-only, which skips the model).

The classes and their prompts live in drone-logger/src/app/inspect/vocabulary.json, shared with the page.
The weights are Ultralytics' (AGPL-3.0), which sits fine with this GPL-3.0 repository.
"""

import argparse
import base64
import json
import os
import shutil
from copy import deepcopy
from pathlib import Path

import numpy as np
import torch
from torch import nn
from ultralytics import YOLOWorld

ROOT = Path(__file__).resolve().parents[2]
VOCABULARY = ROOT / "drone-logger" / "src" / "app" / "inspect" / "vocabulary.json"
EMBEDDINGS = ROOT / "drone-logger" / "src" / "app" / "inspect" / "prompt-embeddings.json"
# How many prompts the model takes at once: the built-in ones plus room for the pilot's own. Keep in step with
# PROMPT_SLOTS in inspect-model.ts.
SLOTS = 96


def prompts() -> list[str]:
    """Every class's prompts, in order."""
    classes = json.loads(VOCABULARY.read_text(encoding="utf-8"))["classes"]
    return [p for c in classes for p in c["prompts"]]


class WithPrompts(nn.Module):
    """YOLO-World with what to look for as an input instead of baked in."""

    def __init__(self, world: nn.Module):
        super().__init__()
        self.world = world

    def forward(self, images: torch.Tensor, txt_feats: torch.Tensor) -> torch.Tensor:
        return self.world.predict(images, txt_feats=txt_feats)


def write_embeddings(names: list[str], feats: torch.Tensor) -> None:
    """The built-in prompts' embeddings for the page, as base64 float32 (little-endian), each scaled to length 1."""
    feats = feats / feats.norm(dim=-1, keepdim=True)
    data = {
        "_comment": "CLIP ViT-B/32 text embeddings of vocabulary.json's prompts, written by tools/inspection/export_model.py. Don't edit.",
        "dims": int(feats.shape[-1]),
        "prompts": {n: base64.b64encode(f.numpy().astype("<f4").tobytes()).decode() for n, f in zip(names, feats)},
    }
    EMBEDDINGS.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    print(f"Wrote {EMBEDDINGS} ({len(names)} prompts)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--size", choices=["s", "m", "l"], default="l", help="model size (default l)")
    parser.add_argument("--keep-default", action="store_true", help="don't replace inspection-v2.onnx, the page's model")
    parser.add_argument("--embeddings-only", action="store_true", help="only write prompt-embeddings.json")
    args = parser.parse_args()

    work = Path(__file__).resolve().parent / "build"
    work.mkdir(exist_ok=True)
    os.chdir(work)  # CLIP's text-encoder weights download into ./weights, so keep them here (git-ignored)

    names = prompts()
    if len(names) > SLOTS:
        raise SystemExit(f"vocabulary.json has {len(names)} prompts; the model takes {SLOTS}. Raise SLOTS (and PROMPT_SLOTS).")
    model = YOLOWorld(str(work / f"yolov8{args.size}-worldv2.pt"))
    model.set_classes(names)
    feats = model.model.txt_feats[0].detach().float()  # (prompts, 512)
    write_embeddings(names, feats)
    if args.embeddings_only:
        return

    world = deepcopy(model.model).float().eval()
    world = world.fuse(verbose=False)
    head = world.model[-1]
    head.nc, head.no = SLOTS, SLOTS + head.reg_max * 4
    head.export, head.format, head.dynamic = True, "onnx", False
    for p in world.parameters():
        p.requires_grad = False
    wrapped = WithPrompts(world).eval()

    # Example inputs: the built-in prompts, the spare slots repeating the first.
    txt = torch.cat([feats, feats[:1].expand(SLOTS - len(names), -1)])[None]
    images = torch.rand(1, 3, 640, 640)
    with torch.no_grad():
        reference = wrapped(images, txt)
    raw = work / f"inspection-{args.size}-v2.raw.onnx"
    torch.onnx.export(wrapped, (images, txt), str(raw), input_names=["images", "txt_feats"], output_names=["output0"],
                      opset_version=17, do_constant_folding=True, dynamo=False)
    import onnx
    import onnxslim

    slim = onnxslim.slim(onnx.load(str(raw)))
    onnx_path = work / f"inspection-{args.size}-v2.onnx"
    onnx.save(slim, str(onnx_path))
    raw.unlink()

    # The exported model must give what PyTorch does, for the built-in prompts and for a different set.
    import onnxruntime as ort

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    for t in (txt, torch.cat([feats.flip(0), feats[-1:].expand(SLOTS - len(names), -1)])[None]):
        with torch.no_grad():
            want = wrapped(images, t).numpy()
        got = session.run(None, {"images": images.numpy(), "txt_feats": t.numpy()})[0]
        # Boxes are in pixels (0..640), scores 0..1: each gets its own tolerance.
        boxes, scores = float(np.abs(got[:, :4] - want[:, :4]).max()), float(np.abs(got[:, 4:] - want[:, 4:]).max())
        print(f"ONNX vs PyTorch: shape {got.shape}, boxes within {boxes:.2e} px, scores within {scores:.2e}")
        if got.shape != want.shape or boxes > 1 or scores > 2e-3:
            raise SystemExit("The exported model doesn't match PyTorch.")
    del reference

    models = ROOT / "drone-logger" / "public" / "models"
    models.mkdir(parents=True, exist_ok=True)
    targets = [models / f"inspection-{args.size}-v2.onnx"] + ([] if args.keep_default else [models / "inspection-v2.onnx"])
    for target in targets:
        shutil.copyfile(onnx_path, target)
        print(f"Wrote {target} ({target.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

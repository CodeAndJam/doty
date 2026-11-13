#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "torch>=2.6",
#   "transformers>=4.46",
#   "onnx>=1.17",
#   "onnxruntime>=1.20",
#   "numpy",
#   "huggingface_hub",
# ]
# ///
"""Export Liquid AI's d1-omni-600M text path to ONNX, with a parity gate.

    uv run --python 3.13 scripts/export-d1-omni.py --out ~/.doty/models

Writes, next to the model:
  d1-omni-text.onnx              fp32 graph, ~2.35 GB
  d1-omni-text-int8.onnx         dynamic int8 MatMul, ~600 MB
  d1-omni-text-manifest.json     calibration, token table, fixture for the TS runner
  d1-omni-text-fixture.json      token ids the ranker must reproduce, and the answers

The graph takes the five tensors the author's `_forward` builds and returns raw
logits, one per option marker:

  input_ids      int64  [1, seq]
  attention_mask int64  [1, seq]
  marker_pos     int64  [1, k]
  marker_mask    bool   [1, k]
  qtype          int64  [1]        choice=0 score=1 noul=2

Temperature and softmax stay in the caller: they are per question type and
option count, and they cost nothing outside the graph.

The gate is the point of this script. Nothing downstream may run against a
graph whose argmax differs from PyTorch on any fixture row, or whose
probabilities drift past the tolerances below.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

import torch  # module level: TextPath is an nn.Module, built at import time

REPO = "LiquidAI/d1-omni-600M"
REVISION = "02b55d7076f15129e59ab3f94783f32c4b088674"
FILES = ["config.json", "model.safetensors", "modeling_d1.py", "encoder.py", "prompt.py",
         "vision.py", "audio.py",  # imported by modeling_d1, never executed: the export is text only
         "tokenizer.json", "tokenizer_config.json", "LICENSE"]

# Fixture rows. Portuguese narration is the case that matters: it is what the app
# ranks against, and it is where a subtly wrong prompt shows up first.
FIXTURES = [
    ("O dragão ergue-se das ruínas e ruge. Os aventureiros preparam as armas enquanto o chão treme.",
     ["Música de combate orquestral", "Tensão subterrânea em cordas graves", "Tema de taberna com flauta",
      "Valsa melancólica de piano", "Tambores de perseguição", "Coro épico de vitória",
      "Ambiente de floresta ao amanhecer", "Drones de terror dissonantes", "Marcha fúnebre lenta",
      "Arpejos de harpa misteriosa", "Percussão tribal em crescendo", "Sino solene e grave",
      "Cordas staccato em ritmo rápido", "Pads etéreos flutuantes", "Metais triunfantes",
      "Sussurros corais inquietantes", "Baixo pulsante e seco", "Címbalos em tensão",
      "Flauta solitária e aguda", "Cordas pulsadas em ostinato"]),
    ("O grupo descansa à volta da fogueira, a conversar baixinho sobre o caminho de amanhã.",
     ["Música de combate orquestral", "Tensão subterrânea em cordas graves", "Tema de taberna com flauta",
      "Valsa melancólica de piano", "Tambores de perseguição", "Coro épico de vitória",
      "Ambiente de floresta ao amanhecer", "Drones de terror dissonantes", "Marcha fúnebre lenta",
      "Arpejos de harpa misteriosa", "Percussão tribal em crescendo", "Sino solene e grave",
      "Cordas staccato em ritmo rápido", "Pads etéreos flutuantes", "Metais triunfantes",
      "Sussurros corais inquietantes", "Baixo pulsante e seco", "Címbalos em tensão",
      "Flauta solitária e aguda", "Cordas pulsadas em ostinato"]),
    ("Roll for initiative.", 
     ["Música de combate orquestral", "Tensão subterrânea em cordas graves", "Tema de taberna com flauta",
      "Valsa melancólica de piano", "Tambores de perseguição", "Coro épico de vitória"]),
]
INSTRUCTIONS = "Qual destas músicas se adequa melhor ao momento atual da sessão?"

FP32_TOL = 1e-4
INT8_TOL = 5e-3

# The head's attention reshapes against the traced sequence length, so the graph is
# exported with static shapes: SEQ tokens, OPTIONS markers. The ranker right-pads every
# row to SEQ and masks the spare markers. Padding is masked in the head
# (`src_key_padding_mask=~pad`), and 1024 tokens covers 20 options plus 800 chars of
# transcript with room to spare.
SEQ = 1024
OPTIONS = 20


def log(msg: str) -> None:
    print(f"[export] {msg}", flush=True)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_prompt_module(repo_dir: Path):
    """prompt.py is self-contained: load it directly, so fixtures use the author's own encoder."""
    spec = importlib.util.spec_from_file_location("d1_prompt", repo_dir / "prompt.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["d1_prompt"] = mod  # @dataclass resolves its own module through sys.modules
    spec.loader.exec_module(mod)
    return mod


def download(dest: Path) -> Path:
    from huggingface_hub import hf_hub_download

    dest.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        target = dest / name
        if target.exists() and target.stat().st_size > 0:
            log(f"have {name}")
            continue
        log(f"fetching {name}")
        tmp = hf_hub_download(REPO, name, revision=REVISION)
        shutil.copyfile(tmp, target)
    return dest


class TextPath(torch.nn.Module):
    """The encoder + head, with the vision and audio branches left out."""

    def __init__(self, model):
        super().__init__()
        self.encoder = model.encoder
        self.head = model.head

    def forward(self, input_ids, attention_mask, marker_pos, marker_mask, qtype):
        emb = self.encoder.embed_tokens(input_ids)
        h = self.encoder(emb, attention_mask.bool(), torch.zeros_like(qtype))
        return self.head(h, attention_mask.bool(), marker_pos, marker_mask, qtype)


def export(model, out: Path) -> Path:
    import torch

    path = out / "d1-omni-text.onnx"
    wrapper = TextPath(model)
    args = (
        torch.zeros(1, SEQ, dtype=torch.long),
        torch.ones(1, SEQ, dtype=torch.long),
        torch.zeros(1, OPTIONS, dtype=torch.long),
        torch.ones(1, OPTIONS, dtype=torch.bool),
        torch.zeros(1, dtype=torch.long),
    )
    log(f"exporting fp32 graph (static {SEQ} tokens, {OPTIONS} markers)")
    torch.onnx.export(
        wrapper,
        args,
        str(path),
        input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
        output_names=["logits"],
        opset_version=20,
        do_constant_folding=True,
        dynamo=False,
    )
    log(f"fp32 graph: {path.stat().st_size / 1e9:.2f} GB")
    return path


def quantize(fp32: Path, out: Path) -> Path:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    path = out / "d1-omni-text-int8.onnx"
    log("quantizing MatMul weights to int8 (QUInt8, reduce_range)")
    quantize_dynamic(str(fp32), str(path), weight_type=QuantType.QUInt8, op_types_to_quantize=["MatMul"],
                     per_channel=True, reduce_range=True)
    log(f"int8 graph: {path.stat().st_size / 1e6:.0f} MB")
    return path


def run_onnx(graph: Path, feeds: dict) -> list[float]:
    import numpy as np
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(str(graph), opts, providers=["CPUExecutionProvider"])
    (logits,) = sess.run(["logits"], feeds)
    return np.asarray(logits).reshape(-1).tolist()


def probabilities(logits: list[float], temperature: float, n: int) -> list[float]:
    import math

    z = [v / temperature for v in logits[:n]]
    top = max(z)
    e = [math.exp(v - top) for v in z]
    s = sum(e)
    return [v / s for v in e]


def argmax(xs: list[float]) -> int:
    return max(range(len(xs)), key=xs.__getitem__)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.expanduser("~/.doty/models"), help="where to write the graphs")
    ap.add_argument("--src", default=None, help="cache dir for the author's files (default: <out>/d1-omni-src)")
    ap.add_argument("--skip-int8", action="store_true")
    ap.add_argument("--pack", action="store_true", help="also write the release archive and print its sha256")
    args = ap.parse_args()

    import numpy as np
    import torch
    from onnxruntime.quantization import QuantType  # noqa: F401  (fail fast on a missing dep)

    out = Path(os.path.expanduser(args.out))
    src = Path(args.src) if args.src else out / "d1-omni-src"
    download(src)

    login = load_prompt_module(src)

    from transformers import AutoModel, AutoTokenizer

    log("loading checkpoint in fp32 (needs ~4 GB of RAM)")
    model = AutoModel.from_pretrained(str(src), trust_remote_code=True, torch_dtype=torch.float32).eval()
    tok = AutoTokenizer.from_pretrained(str(src), trust_remote_code=True)
    temps = model.config.temperatures

    # ---- fixtures: the author's own encoder builds the token rows, his own model answers them
    rows = []
    for state, options in FIXTURES:
        # Bare labels, no descriptions: that is exactly what the ranker sends, so the
        # gate verifies the row shape production actually builds.
        q = login.Question("choice", INSTRUCTIONS, {text: None for text in options})
        ids, markers = login.encode(tok, state, q, model.config.max_length, per_option=24)
        rows.append({"state": state, "options": options, "ids": ids, "markers": markers,
                     "ids_of": {k: tok.convert_tokens_to_ids(v) for k, v in login.DELIM.items() | {"mask": login.MARKER}.items()}})
        log(f"row: {len(ids)} tokens, {len(markers)} options")

    reference = []
    for (state, options), row in zip(FIXTURES, rows):
        answers = model.system_one(state, {"pick": {"type": "choice", "instructions": INSTRUCTIONS,
                                                    "criteria": {o: None for o in options}}})
        reference.append(list(answers["answers"]["pick"]["probabilities"].values()))
    for row, probs in zip(rows, reference):
        row["probabilities"] = list(probs)

    graph = export(model, out)

    def check(graph: Path, tolerance: float, label: str) -> bool:
        worst = 0.0
        ok = True
        for row, expected in zip(rows, reference):
            seq = len(row["ids"])
            k = len(row["markers"])
            if seq > SEQ or k > OPTIONS:
                log(f"FAIL {label}: row is {seq} tokens / {k} options, over the static shape")
                return False
            ids = row["ids"] + [0] * (SEQ - seq)
            mask = [1] * seq + [0] * (SEQ - seq)
            pos = row["markers"] + [0] * (OPTIONS - k)
            mmask = [True] * k + [False] * (OPTIONS - k)
            feeds = {
                "input_ids": np.array([ids], dtype=np.int64),
                "attention_mask": np.array([mask], dtype=np.int64),
                "marker_pos": np.array([pos], dtype=np.int64),
                "marker_mask": np.array([mmask], dtype=bool),
                "qtype": np.zeros((1,), dtype=np.int64),
            }
            logits = run_onnx(graph, feeds)[:k]
            key = f"choice:{'2' if k <= 2 else '3-5' if k <= 5 else '6-10' if k <= 10 else '11+'}"
            got = probabilities(logits, temps.get(key, 1.0), k)
            want = list(expected)
            diff = max(abs(a - b) for a, b in zip(got, want))
            worst = max(worst, diff)
            if argmax(got) != argmax(want):
                log(f"FAIL {label}: argmax {argmax(got)} != {argmax(want)} (k={k})")
                ok = False
            elif diff > tolerance:
                log(f"FAIL {label}: max |dp| = {diff:.2e} > {tolerance:.0e} (k={k})")
                ok = False
        log(f"{label}: worst |dp| = {worst:.2e} over {len(rows)} rows")
        return ok

    if not check(graph, FP32_TOL, "fp32"):
        return 1

    int8 = None
    if not args.skip_int8:
        int8 = quantize(graph, out)
        if not check(int8, INT8_TOL, "int8"):
            log("int8 failed the gate: removing it, the fp32 graph is the one to ship")
            int8.unlink()
            int8 = None

    manifest = {
        "family": "d1-omni",
        "source": f"huggingface.co/{REPO}@{REVISION}",
        "license": "LFM Open License v1.0",
        "license_note": "commercial use by an organisation with US$10M+ annual revenue needs a separate agreement",
        "context_length": model.config.max_length,
        "per_option_tokens": 24,
        "shape": {"seq": SEQ, "options": OPTIONS, "padding": "right, ids 0, attention_mask 0"},
        "precision": "fp32",
        "quantized": None if int8 is None else "int8 (MatMul only)",
        "temperatures": temps,
        "noul_order": ["false", "true"],
        "qtypes": login.QTYPES,
        "tokens": {k: tok.convert_tokens_to_ids(v) for k, v in login.DELIM.items()} | {"mask": tok.convert_tokens_to_ids(login.MARKER), "bos": tok.bos_token_id},
        "graphs": {
            "d1-omni-text.onnx": {"bytes": graph.stat().st_size, "sha256": sha256(graph)},
            **({int8.name: {"bytes": int8.stat().st_size, "sha256": sha256(int8)}} if int8 else {}),
        },
    }
    (out / "d1-omni-text-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (out / "d1-omni-text-fixture.json").write_text(json.dumps(rows, indent=1) + "\n")
    log(f"wrote {out / 'd1-omni-text-manifest.json'}")
    log(f"wrote {out / 'd1-omni-text-fixture.json'}")
    log("gate passed")

    if args.pack:
        import tarfile

        archive = out / "d1-omni-text-v1.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            for name in ("d1-omni-text.onnx", "d1-omni-text-manifest.json",
                         "d1-omni-src/tokenizer.json", "d1-omni-src/tokenizer_config.json"):
                tar.add(out / name, arcname=name)
        digest = sha256(archive)
        log(f"archive: {archive} ({archive.stat().st_size} bytes)")
        log(f"sha256:  {digest}")
        log("upload it to the models-v1 release and put that sha256 in electron/d1-model.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
